# Project Explanation: Distributed API Gateway With Rate Limiting

## 1. Short Project Pitch

This project is a distributed API gateway built with TypeScript, Express, Redis, Docker Compose, Prometheus, Grafana, and k6.

The gateway sits in front of backend services and handles common cross-cutting concerns:

- JWT authentication
- Distributed rate limiting
- Request metrics
- Basic routing and proxying
- Simple round-robin service selection
- Load testing with k6
- Observability with Prometheus and Grafana

The most important part of the project is the distributed rate limiter. Instead of each gateway instance maintaining its own in-memory request counter, all gateway instances share rate limit state through Redis. This means if a user sends requests to `gateway1`, `gateway2`, and `gateway3`, the user still has one shared rate limit.

In an interview, a good one-minute explanation would be:

> I built a small distributed API gateway that demonstrates how production gateways handle authentication, rate limiting, routing, and observability. The system runs three stateless gateway instances behind Docker Compose. Each request is authenticated with JWT, then checked against a Redis-backed token bucket rate limiter. Redis stores the shared token state, and a Lua script performs the refill and consume operation atomically. This prevents race conditions when multiple gateway instances receive requests at the same time. I also exposed Prometheus metrics and used k6 to load test the system and verify that the rate limit works across multiple gateway containers.

## 2. Problem This Project Solves

In real systems, backend services should not each repeat the same infrastructure logic. For example, every service should not individually implement:

- Authentication checks
- Rate limiting
- Request metrics
- Routing decisions
- Common error handling

An API gateway centralizes these concerns.

The more interesting problem is rate limiting in a distributed environment.

If there is only one server, rate limiting can be done using an in-memory map:

```text
user123 -> 10 requests remaining
```

But once the system has multiple gateway instances, in-memory rate limiting breaks.

Example:

```text
gateway1 gives user123 10 requests
gateway2 gives user123 10 requests
gateway3 gives user123 10 requests
```

Now the user effectively gets 30 requests instead of 10.

This project fixes that by moving rate limit state out of individual gateway containers and into Redis:

```text
gateway1 \
gateway2  -> Redis shared token bucket
gateway3 /
```

That makes the gateway instances stateless and horizontally scalable.

## 3. High-Level Architecture

The Docker Compose setup runs these services:

```text
Client / k6
   |
   | HTTP request with JWT
   v
+-------------------+
| gateway1 :3000    |
| gateway2 :3001    |
| gateway3 :3002    |
+-------------------+
   |
   | shared rate limit state
   v
+-------------------+
| Redis             |
+-------------------+
   |
   | metrics scraped by
   v
+-------------------+
| Prometheus        |
+-------------------+
   |
   | dashboard data source
   v
+-------------------+
| Grafana           |
+-------------------+
```

There is also a Docker Compose `k6` service that generates load against the gateway containers.

The gateway containers are intentionally stateless. They can be recreated, scaled, or restarted without losing rate limit correctness because the important shared state lives in Redis.

## 4. Main Components

### Express Application

The Express app is created in `src/app.ts`.

It registers:

- JSON body parsing
- `/metrics` endpoint
- metrics middleware
- authentication middleware
- rate limiting middleware
- demo routes for `/users` and `/payments`
- fallback proxy handler

The middleware order matters:

```text
metrics -> auth -> rate limit -> route/proxy
```

This order means:

1. Request metrics are captured early.
2. Authentication happens before rate limiting.
3. The rate limiter can use the authenticated user's `user_id`.
4. Only allowed requests reach the actual route or proxy handler.

The `/metrics` endpoint is registered before the auth middleware, so Prometheus can scrape it without needing a JWT token.

### Server Startup

The server starts from `src/server.ts`.

Before listening for requests, it calls `loadLuaScript()`.

That step loads the Redis Lua script into Redis and stores the script SHA. Later, each request can run the script efficiently using `evalsha`.

This is important because the rate limiter depends on the Lua script being available before traffic arrives.

### JWT Authentication

Authentication is handled in `src/middleware/auth.middleware.ts`.

The middleware expects this header:

```http
Authorization: Bearer <jwt-token>
```

If the token is missing, the response is `401`.

If the token is invalid, the response is also `401`.

If the token is valid, the decoded payload is attached to:

```ts
req.user;
```

The rate limiter later reads:

```ts
req.user?.user_id;
```

That means rate limits can be applied per authenticated user.

### Redis Client

Redis connection logic is in `src/services/redisClient.ts`.

Locally, the gateway uses:

```text
127.0.0.1:6379
```

Inside Docker Compose, the gateway uses:

```text
redis:6379
```

That works because Docker Compose creates a network where services can reach each other by service name.

## 5. Distributed Rate Limiting

The central technical feature is the Redis-backed token bucket rate limiter.

### Why Token Bucket?

The token bucket algorithm is useful because it allows controlled bursts while still enforcing an average rate over time.

In this project:

```ts
const maxTokens = 10;
const refillRate = 1;
```

This means:

- A user can burst up to 10 immediate requests.
- The bucket refills at 1 token per second.
- Each allowed request consumes 1 token.
- If the bucket has 0 tokens, the request is rejected with `429 Too Many Requests`.

### How The Key Is Chosen

The rate limiter builds a key like this:

```ts
const userId = req.user?.user_id;
const key = userId ? `user:${userId}` : `ip:${req.ip}`;
```

For authenticated traffic, the key is user-based:

```text
user:user123
```

If there is no user, the fallback is IP-based:

```text
ip:127.0.0.1
```

In the current middleware order, auth runs before rate limiting, so normal protected traffic should use the user-based key.

### Redis Keys

For each user or IP, Redis stores two values:

```text
tokens:<key>
timestamp:<key>
```

Example:

```text
tokens:user:user123
timestamp:user:user123
```

The token key stores how many tokens are currently available.

The timestamp key stores the last time the bucket was updated.

### Why Lua Is Used

The token bucket logic needs to do multiple operations:

1. Read the current token count.
2. Read the previous timestamp.
3. Calculate how many tokens should be refilled.
4. Decide if the request is allowed.
5. Update the token count.
6. Update the timestamp.

If these were separate Redis commands, two gateway instances could interleave their operations and cause incorrect results.

For example:

```text
gateway1 reads 1 token
gateway2 reads 1 token
gateway1 consumes token
gateway2 consumes token
```

Both requests could be allowed even though only one token existed.

The Lua script fixes this because Redis executes a Lua script atomically. While the script is running, no other Redis command can modify the same state in the middle of the operation.

That is the key distributed-systems idea in this project.

### Lua Script Behavior

The Lua script receives:

```text
KEYS[1] = token key
KEYS[2] = timestamp key
ARGV[1] = max tokens
ARGV[2] = refill rate
ARGV[3] = current time
```

Then it:

1. Loads existing token and timestamp values.
2. Initializes missing values for a new user.
3. Calculates elapsed time since the last request.
4. Refills tokens based on elapsed time.
5. Caps tokens at `maxTokens`.
6. Allows the request if at least 1 token is available.
7. Stores the updated token count and timestamp.
8. Returns `1` for allowed or `0` for blocked.

The TypeScript service converts that result into a boolean:

```ts
return result === 1;
```

### Fail-Open Behavior

The rate limiting middleware has fail-open behavior:

```ts
catch (err) {
  next();
}
```

That means if Redis fails, the gateway allows traffic instead of blocking every request.

This is a deliberate availability tradeoff:

- Fail-open protects user traffic if Redis has a temporary issue.
- Fail-closed would protect backend services more aggressively but could cause an outage if Redis is unavailable.

In an interview, you can say:

> For this project I chose fail-open because it is a demo gateway and I wanted Redis failure to avoid taking down all traffic. In a production system, the choice depends on the business. For login or payment APIs, fail-closed or local fallback limits might be safer. For less sensitive APIs, fail-open may be acceptable.

## 6. Request Flow In Detail

For a normal request to `/users`, the flow is:

```text
1. Client sends GET /users with Authorization header.
2. Express parses JSON if a body exists.
3. Metrics middleware increments total request count.
4. Auth middleware validates the JWT.
5. Auth middleware attaches decoded user data to req.user.
6. Rate limit middleware builds a user-based Redis key.
7. Rate limiter executes the Lua token bucket script in Redis.
8. If Redis returns allowed, the request continues.
9. If Redis returns blocked, gateway responds with 429.
10. Express route returns the /users demo response.
11. Metrics middleware records request duration when the response finishes.
```

For a request to an unknown path, the request eventually reaches `proxyHandler`.

The proxy handler:

1. Extracts the first path segment.
2. Looks it up in the route table.
3. Selects a target service using round-robin.
4. Forwards the request with Axios.
5. Returns the backend response.

If no route exists, it returns:

```json
{
  "message": "Route not found"
}
```

## 7. Routing And Load Balancing

Routes are defined in `src/router/routeResolver.ts`:

```ts
export const routes: Record<string, string[]> = {
  "/users": ["http://localhost:4001"],
  "/payments": ["http://localhost:4002"],
};
```

The load balancer in `src/router/loadBalancer.ts` uses a simple round-robin counter:

```ts
index = (index + 1) % services.length;
return services[index];
```

In this project, `/users` and `/payments` also have direct demo handlers in `src/app.ts`, so those routes return demo data before the proxy handler is reached.

The proxy code is still useful to show how the gateway could forward traffic to real backend services.

In an interview, you can describe it like this:

> The routing layer is intentionally simple. It maps public paths to backend service URLs, and the load balancer picks the next target using round-robin. In a production version, I would externalize the route config, add health checks, retries, timeouts, circuit breaking, and better per-service observability.

## 8. Observability

This project uses `prom-client` to expose metrics from each gateway instance.

The `/metrics` endpoint exposes:

- Total HTTP requests
- Total rate-limited requests
- Request duration histogram
- Default Node.js process metrics

Prometheus is configured in `prometheus.yml` to scrape:

```text
gateway1:3000
gateway2:3000
gateway3:3000
```

That shows the distributed nature of the system. Each gateway instance exposes its own metrics, and Prometheus collects all of them.

Grafana can use Prometheus as a data source with:

```text
http://prometheus:9090
```

Inside Docker Compose, Grafana uses the service name `prometheus`, not `localhost`.

Good Prometheus queries for explaining the project:

```text
http_requests_total
rate(http_requests_total[1m])
rate_limited_total
rate(rate_limited_total[1m])
http_request_duration_ms_count
```

## 9. Load Testing With k6

k6 is used to prove that the system behaves correctly under concurrent traffic.

The load tests are in `load-tests`.

The multi-user test:

- Picks a random JWT token.
- Picks a random gateway container.
- Sends a request to the configured endpoint.
- Counts `429` responses.
- Checks whether responses are either successful or rate-limited.

Inside Docker, the k6 scripts call gateway containers by service name:

```js
export const BASE_URLS = [
  "http://gateway1:3000",
  "http://gateway2:3000",
  "http://gateway3:3000",
];
```

This is important. From inside a Docker container, `localhost` would mean the k6 container itself, not the host machine and not a gateway container.

The clean command to rerun a load test is:

```bash
docker compose --profile load-test run --rm k6
```

To reset Redis state before a clean test:

```bash
docker compose exec redis redis-cli flushall
docker compose --profile load-test run --rm k6
```

In an interview, you can say:

> I used k6 to simulate traffic across all three gateway instances. That helped validate the most important behavior: even when traffic is distributed across multiple containers, rate limiting still uses one shared Redis state and does not reset per instance.

## 10. Docker And Deployment Model

The Dockerfile builds the TypeScript app:

```text
npm install
npm run build
copy Lua scripts into dist
node dist/server.js
```

The Lua copy step matters because TypeScript compilation outputs JavaScript into `dist`, but the Lua file is not compiled by TypeScript. The runtime service expects the Lua script to exist at:

```text
dist/lua/tokenBucket.lua
```

Docker Compose creates the full local system:

- Redis
- Three gateway instances
- Prometheus
- Grafana
- Optional k6 load-test service

Each gateway runs the same image but gets a different host port:

```text
gateway1 -> localhost:3000
gateway2 -> localhost:3001
gateway3 -> localhost:3002
```

Inside the Compose network, all gateways still listen on port `3000`.

This distinction is important:

```text
Host machine uses localhost:3000, localhost:3001, localhost:3002
Docker containers use gateway1:3000, gateway2:3000, gateway3:3000
```

## 11. Design Decisions And Tradeoffs

### Why Redis?

Redis is fast, simple, and commonly used for distributed counters and rate limiters.

It is a good fit because:

- The data is small.
- Access needs to be very fast.
- Multiple gateway instances need shared state.
- Expensive relational database transactions are unnecessary.

### Why Lua Instead Of Multiple Redis Commands?

Lua gives atomicity.

Without Lua, the token bucket operation would be vulnerable to race conditions under concurrent requests.

With Lua, Redis runs the whole decision as one atomic operation.

### Why Stateless Gateways?

Stateless gateways are easier to scale.

If traffic increases, we can add more gateway containers. Since state is in Redis, a new gateway does not need warm-up state to enforce the same user limits.

### Why Prometheus?

Prometheus is a common monitoring tool for containerized systems.

It fits well because each gateway exposes a `/metrics` endpoint, and Prometheus periodically scrapes all gateway instances.

### Why k6?

k6 is simple for HTTP load testing and works well inside Docker Compose.

It lets us test whether rate limiting works when requests are concurrent and distributed across multiple gateway instances.

## 12. What Happens Under Load?

Suppose one user starts sending many requests.

At the beginning, the user has 10 tokens:

```text
tokens:user:user123 = 10
```

Each request consumes one token:

```text
10 -> 9 -> 8 -> ... -> 0
```

When tokens reach 0, the gateway starts returning:

```http
429 Too Many Requests
```

Over time, tokens refill:

```text
1 token per second
```

So if the user waits, requests become allowed again.

The important distributed behavior is that this does not matter:

```text
Request 1 -> gateway1
Request 2 -> gateway2
Request 3 -> gateway3
```

All three gateways check and update the same Redis keys.

## 13. Limitations Of The Current Version

This project is intentionally focused and educational. Some parts are simplified.

Current limitations:

- JWT secret is hardcoded.
- Route configuration is hardcoded.
- Demo `/users` and `/payments` routes are local handlers.
- Proxy targets point to local backend URLs that are not included as services.
- Metrics do not yet include labels like method, route, status code, or gateway instance.
- The rate limiter does not set Redis key expiry.
- There are no automated tests yet.
- The round-robin load balancer is in-memory per gateway instance.
- There are no retries, circuit breakers, or backend health checks.

These are good things to mention honestly in an interview because they show engineering judgment.

## 14. How I Would Improve It For Production

Good production improvements:

- Move JWT secret to environment variables.
- Add `.env.example`.
- Add Redis key expiry to clean up inactive users.
- Add per-route and per-plan rate limits.
- Add labels to Prometheus metrics:
  - method
  - route
  - status code
  - service name
- Add backend health checks.
- Add retries with timeouts.
- Add circuit breaker behavior.
- Add centralized route configuration.
- Add tests for auth, rate limiting, and proxy behavior.
- Add Grafana dashboard provisioning.
- Add structured logging with request IDs.
- Add graceful shutdown.
- Add multiple rate limit strategies, such as sliding window or fixed window.

An interview-ready answer:

> If I productionized this, I would first move secrets and route config out of code, add automated tests, and improve observability labels. Then I would add key expiry in Redis so old users do not leave stale keys forever. For the proxy layer, I would add timeouts, retries, circuit breakers, and health-aware load balancing. The current version demonstrates the core distributed rate limiting idea, while those improvements would make it closer to a real production gateway.

## 15. Interview Questions You Can Expect

### Why is Redis needed here?

Because multiple gateway instances need one shared rate limit state. If every gateway stored counters in memory, the user could exceed the intended limit by spreading traffic across instances.

### Why use Lua in Redis?

Because the rate limit check requires multiple reads and writes. Lua makes the entire operation atomic, preventing race conditions when many gateway instances update the same user's bucket concurrently.

### What algorithm did you use for rate limiting?

Token bucket. Each user has a bucket with a maximum capacity. Requests consume tokens, and tokens refill over time. This supports small bursts while enforcing a long-term average rate.

### What happens if Redis goes down?

The current implementation fails open, meaning requests are allowed if the rate limiter throws an error. This favors availability. In production, the choice between fail-open and fail-closed depends on the API and business risk.

### How do you know the rate limiter is distributed?

The Docker setup runs three gateway containers, and k6 sends traffic across all of them. Since rate limit state is stored in Redis, the limit is shared across instances. Prometheus and Redis key inspection can confirm the behavior.

### What does Prometheus monitor?

Each gateway exposes `/metrics`. Prometheus scrapes all three gateway containers and collects request counts, rate-limited counts, request duration histograms, and default Node.js process metrics.

### Is the gateway itself load balanced?

In this local demo, the client or k6 directly chooses between `gateway1`, `gateway2`, and `gateway3`. In a real deployment, an external load balancer like NGINX, AWS ALB, Kubernetes Service, or an ingress controller would distribute traffic across gateway instances.

### Why are the gateways stateless?

Stateless gateways are easier to scale and replace. Since Redis holds shared rate limit state, any gateway instance can handle any request.

## 16. Strong End-To-End Explanation

Here is a complete answer you can practice:

> This project is a distributed API gateway built with TypeScript and Express. I designed it to demonstrate common gateway responsibilities like authentication, rate limiting, routing, and observability. The system runs multiple gateway containers using Docker Compose, along with Redis, Prometheus, Grafana, and k6 for load testing.
>
> The most important feature is distributed rate limiting. Each request first passes through metrics middleware, then JWT authentication, and then the rate limiter. Once the JWT is validated, the gateway extracts the user ID and uses it as the rate limit key. The token bucket state is stored in Redis, with one key for the token count and another key for the last update timestamp.
>
> I used a token bucket algorithm because it supports short bursts while still enforcing a steady refill rate. The current settings allow 10 burst requests and refill 1 token per second. If a request arrives and the user has at least one token, the request is allowed and one token is consumed. If no tokens are available, the gateway returns 429.
>
> The Redis update is done with a Lua script. That is important because the operation involves reading tokens, calculating refill, deciding whether to allow the request, and writing the updated state. If those were separate Redis commands, concurrent requests across gateway instances could race. Redis executes the Lua script atomically, so the rate limit remains correct even when traffic hits multiple gateway containers at once.
>
> I also added Prometheus metrics so each gateway exposes request counts, rate-limited counts, and request duration. Prometheus scrapes all three gateway instances, and Grafana can visualize the metrics. For validation, I used k6 to generate traffic across the gateway containers and verify that rate limiting still works as one shared limit rather than one limit per container.
>
> The current version is intentionally simple, but the core architecture is production-inspired: stateless gateways, shared Redis coordination, atomic rate limit decisions, and observability around the system.

## 17. Quick Demo Script For An Interview

A clean demo flow:

```bash
docker compose up --build -d redis gateway1 gateway2 gateway3 prometheus grafana
```

Show running containers:

```bash
docker compose ps
```

Run the load test:

```bash
docker compose --profile load-test run --rm k6
```

Inspect Redis keys:

```bash
docker compose exec redis redis-cli keys "*"
```

Check gateway logs:

```bash
docker compose logs -f gateway1 gateway2 gateway3
```

Open Prometheus:

```text
http://localhost:9090
```

Try:

```text
rate(http_requests_total[1m])
rate(rate_limited_total[1m])
```

Open Grafana:

```text
http://localhost:3005
```

Use Prometheus data source:

```text
http://prometheus:9090
```

## 18. Final Interview Framing

The project is valuable because it demonstrates more than just Express routing. It shows several backend engineering ideas together:

- Stateless service design
- Shared distributed state
- Atomic concurrency control with Redis Lua
- Token bucket rate limiting
- JWT-based identity
- Containerized multi-instance deployment
- Metrics and monitoring
- Load testing

The main thing to emphasize is:

> This project shows why distributed systems need shared coordination. A rate limiter that works on one server can become incorrect when the system is scaled horizontally. By moving token bucket state to Redis and using Lua for atomic updates, the gateway enforces one consistent limit across multiple running instances.
