# Distributed API Gateway Rate Limiting Guide

This document explains what was built in this project, how the pieces fit together, how to run it locally or with Docker, how to debug common problems, and how to run load tests repeatedly with the Docker `k6` service.

## Project Summary

This project is a TypeScript and Express based distributed API gateway. The gateway is designed to sit in front of backend services and handle shared infrastructure concerns in one place:

- JWT authentication
- Redis backed distributed rate limiting
- Request routing
- Simple round-robin service selection
- Prometheus metrics
- Docker Compose based multi-instance runtime
- k6 load testing

The important distributed systems idea is that gateway instances are stateless. Any state needed for rate limiting is stored in Redis, so multiple gateway containers can enforce one shared limit instead of each instance tracking its own isolated counter.

## What We Built

### 1. Base TypeScript Express App

Files:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/app.ts`
- `src/server.ts`

The app uses Express as the HTTP server framework and TypeScript for type safety.

`src/app.ts` creates the Express application, registers middleware, exposes `/metrics`, defines simple demo routes, and attaches the proxy handler.

`src/server.ts` starts the gateway. Before listening for traffic, it loads the Redis Lua script used by the rate limiter.

Current scripts:

```bash
npm run dev
npm run build
npm start
npm run format
npm run format:check
```

### 2. JWT Authentication Middleware

File:

- `src/middleware/auth.middleware.ts`

The auth middleware reads the `Authorization` header, expects a Bearer token, verifies it with the configured secret, and attaches the decoded user data to `req.user`.

Expected request format:

```http
Authorization: Bearer <jwt-token>
```

If the token is missing, the gateway returns:

```json
{
  "message": "No token provided"
}
```

If the token is invalid, the gateway returns:

```json
{
  "message": "Invalid token"
}
```

### 3. Redis Backed Token Bucket Rate Limiting

Files:

- `src/services/redisClient.ts`
- `src/services/rateLimiter.service.ts`
- `src/lua/tokenBucket.lua`
- `src/middleware/rateLimit.middleware.ts`

Redis is used as the shared store for rate limiting state.

The gateway uses a token bucket algorithm:

- Each user starts with a maximum number of tokens.
- Every request consumes one token.
- Tokens refill over time.
- If no tokens are available, the request is rejected with HTTP `429`.

Current values:

```ts
const maxTokens = 10;
const refillRate = 1; // token per second
```

The Lua script is important because it makes the token calculation atomic inside Redis. Without Lua, multiple gateway instances could read and write token values at the same time and accidentally allow too many requests.

Redis keys:

```text
tokens:<key>
timestamp:<key>
```

The rate limiter builds the key from the authenticated user when possible:

```text
user:<user_id>
```

If no user is present, it falls back to the request IP:

```text
ip:<request-ip>
```

The middleware is fail-open. If Redis or the rate limiter fails, the request is allowed to continue instead of blocking all traffic.

### 4. Routing, Proxying, and Load Balancing

Files:

- `src/router/routeResolver.ts`
- `src/router/loadBalancer.ts`
- `src/router/proxy.ts`

`routeResolver.ts` maps public gateway paths to backend service URLs.

Current route map:

```ts
export const routes: Record<string, string[]> = {
  "/users": ["http://localhost:4001"],
  "/payments": ["http://localhost:4002"],
};
```

`loadBalancer.ts` selects the next service using a simple round-robin index.

`proxy.ts` receives the incoming request, finds the matching service list, chooses one target, forwards the request with Axios, and returns the backend response to the client.

If no route exists, the gateway returns HTTP `404`.

If the backend call fails, the gateway returns HTTP `500`.

### 5. Prometheus Metrics

Files:

- `src/services/metrics.service.ts`
- `src/middleware/metrics.middleware.ts`
- `prometheus.yml`

The gateway exposes Prometheus metrics on:

```text
/metrics
```

Metrics currently include:

- `http_requests_total`
- `rate_limited_total`
- `http_request_duration_ms`
- default Node.js process metrics from `prom-client`

Prometheus is configured to scrape all three gateway containers:

```text
gateway1:3000
gateway2:3000
gateway3:3000
```

### 6. Docker Runtime

Files:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

The Docker setup runs:

- Redis
- 3 gateway containers
- Prometheus
- Grafana
- k6 load testing service

Gateway ports:

```text
gateway1 -> http://localhost:3000
gateway2 -> http://localhost:3001
gateway3 -> http://localhost:3002
```

Prometheus:

```text
http://localhost:9090
```

Grafana:

```text
http://localhost:3005
```

### 7. k6 Load Tests

Files:

- `load-tests/config.js`
- `load-tests/options.js`
- `load-tests/single-user.js`
- `load-tests/multi-user.js`
- `load-tests/mixed-traffic.js`

The load tests are designed to call gateway containers from inside the Docker Compose network.

Important: inside Docker, the k6 scripts use service names:

```js
export const BASE_URLS = [
  "http://gateway1:3000",
  "http://gateway2:3000",
  "http://gateway3:3000",
];
```

That means these scripts are intended to run through Docker Compose, not directly from your host machine unless you change the URLs to `localhost` ports.

## Request Flow

The current request flow is:

```text
Client
  -> Express app
  -> metrics middleware
  -> auth middleware
  -> rate limit middleware
  -> local demo route or proxy handler
  -> route resolver
  -> load balancer
  -> backend service
  -> response
```

For `/metrics`, the request bypasses the normal middleware chain because the metrics route is registered before auth and rate limiting.

## How To Run Locally Without Docker

This mode is useful when you want fast TypeScript development.

### 1. Install dependencies

```bash
npm install
```

### 2. Start Redis

You need Redis running locally on port `6379`.

Using Docker:

```bash
docker run --name local-rate-limit-redis -p 6379:6379 redis:7-alpine
```

If the container already exists:

```bash
docker start local-rate-limit-redis
```

### 3. Run the gateway in dev mode

```bash
npm run dev
```

Default server:

```text
http://localhost:3000
```

### 4. Test the server

The protected routes require a valid JWT:

```bash
curl -H "Authorization: Bearer <jwt-token>" http://localhost:3000/users
```

Metrics do not require auth:

```bash
curl http://localhost:3000/metrics
```

## How To Run With Docker Compose

This is the preferred mode for demonstrating distributed rate limiting because it starts multiple gateway instances sharing one Redis.

### 1. Build and start the stack

```bash
docker compose up --build
```

This starts Redis, gateway instances, Prometheus, and Grafana.

### 2. Run in the background

```bash
docker compose up --build -d
```

### 3. Check running containers

```bash
docker compose ps
```

### 4. View logs

All services:

```bash
docker compose logs -f
```

Only one gateway:

```bash
docker compose logs -f gateway1
```

Redis:

```bash
docker compose logs -f redis
```

Prometheus:

```bash
docker compose logs -f prometheus
```

### 5. Stop the stack

```bash
docker compose down
```

### 6. Stop and remove volumes

Use this when you want a clean Redis and Prometheus/Grafana state:

```bash
docker compose down -v
```

## How To Debug

### Check TypeScript build errors

```bash
npm run build
```

If the build fails, fix TypeScript errors before rebuilding Docker images.

### Check formatting

```bash
npm run format:check
```

Format files:

```bash
npm run format
```

### Debug Redis connection problems

For local development, the gateway expects:

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

For Docker Compose, the gateway containers use:

```text
REDIS_HOST=redis
REDIS_PORT=6379
```

Check Redis health:

```bash
docker compose exec redis redis-cli ping
```

Expected output:

```text
PONG
```

Inspect rate limit keys:

```bash
docker compose exec redis redis-cli keys "*"
```

Check a token key:

```bash
docker compose exec redis redis-cli get tokens:user:user123
```

Check a timestamp key:

```bash
docker compose exec redis redis-cli get timestamp:user:user123
```

Flush Redis state when you want a fresh rate limit test:

```bash
docker compose exec redis redis-cli flushall
```

### Debug gateway startup

Check gateway logs:

```bash
docker compose logs -f gateway1
```

Useful startup messages:

```text
Redis connected
Gateway running at http://0.0.0.0:3000
```

If the gateway fails before listening, check:

- Redis is healthy.
- The Lua file exists in `dist/lua` after Docker build.
- `npm run build` passes.
- Environment variables are set correctly.

### Debug authentication

If every request returns `401`, check:

- The `Authorization` header exists.
- The header starts with `Bearer `.
- The token was signed with the same secret used by `auth.middleware.ts`.
- The token payload contains `user_id` if you want per-user rate limiting.

### Debug rate limiting

If rate limiting does not happen:

- Make sure Redis is running.
- Make sure multiple requests use the same `user_id`.
- Inspect Redis keys.
- Confirm the Lua script is loaded at startup.
- Confirm the request is passing through `rateLimit.middleware.ts`.

If rate limiting happens too quickly:

- Lower load test VUs.
- Increase `maxTokens`.
- Increase `refillRate`.
- Flush Redis before rerunning a test.

### Debug Prometheus

Open:

```text
http://localhost:9090
```

Try these queries:

```text
http_requests_total
rate_limited_total
http_request_duration_ms_count
```

Check Prometheus targets:

```text
http://localhost:9090/targets
```

All gateway targets should be up.

### Debug Grafana

Open:

```text
http://localhost:3005
```

Default Grafana login is usually:

```text
admin / admin
```

Add Prometheus as a data source:

```text
http://prometheus:9090
```

Use the Docker service name, not `localhost`, because Grafana runs inside the Docker Compose network.

## How To Load Test With Docker k6

The `k6` service is behind a Docker Compose profile named `load-test`. It does not run during normal `docker compose up` unless the profile is enabled.

The default command in `docker-compose.yml` is:

```yaml
command: run /scripts/multi-user.js
```

That means this command runs the multi-user load test:

```bash
docker compose --profile load-test up k6
```

### Recommended Repeatable Workflow

Start the main services in the background:

```bash
docker compose up --build -d redis gateway1 gateway2 gateway3 prometheus grafana
```

Run the default k6 test:

```bash
docker compose --profile load-test up k6
```

Run it again:

```bash
docker compose --profile load-test up k6
```

If Docker says the k6 container already exists or was already created, remove it and rerun:

```bash
docker compose rm -f k6
docker compose --profile load-test up k6
```

One-line repeat command:

```bash
docker compose rm -f k6 && docker compose --profile load-test up k6
```

On PowerShell, use:

```powershell
docker compose rm -f k6; docker compose --profile load-test up k6
```

### Run k6 Without Recreating the Service

You can also run a one-off k6 container:

```bash
docker compose --profile load-test run --rm k6
```

This is often the cleanest repeated command because `--rm` removes the k6 container after the test finishes.

Repeat it as many times as needed:

```bash
docker compose --profile load-test run --rm k6
```

### Run a Specific k6 Script

Single user test:

```bash
docker compose --profile load-test run --rm k6 run /scripts/single-user.js
```

Multi-user test:

```bash
docker compose --profile load-test run --rm k6 run /scripts/multi-user.js
```

Mixed authenticated and unauthenticated traffic:

```bash
docker compose --profile load-test run --rm k6 run /scripts/mixed-traffic.js
```

### Reset Rate Limit State Between Tests

If you want each load test to start fresh:

```bash
docker compose exec redis redis-cli flushall
docker compose --profile load-test run --rm k6
```

PowerShell:

```powershell
docker compose exec redis redis-cli flushall; docker compose --profile load-test run --rm k6
```

### Watch Logs While Load Testing

In one terminal:

```bash
docker compose logs -f gateway1 gateway2 gateway3 redis
```

In another terminal:

```bash
docker compose --profile load-test run --rm k6
```

### Watch Metrics While Load Testing

Open Prometheus:

```text
http://localhost:9090
```

Useful queries:

```text
rate(http_requests_total[1m])
rate(rate_limited_total[1m])
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[1m]))
```

## Common Problems And Fixes

### Problem: k6 cannot reach the gateway

Use Docker service names inside k6 scripts:

```text
http://gateway1:3000
http://gateway2:3000
http://gateway3:3000
```

Do not use `localhost` inside k6 when k6 runs in Docker. Inside the k6 container, `localhost` means the k6 container itself.

### Problem: Requests return 401 during load test

Check that the tokens in `load-tests/config.js` are signed with the same secret used in `src/middleware/auth.middleware.ts`.

Also note that `single-user.js` currently uses:

```js
const TOKEN = "TOKEN_USER_1";
```

That placeholder will return `401` unless replaced with a valid JWT.

### Problem: Requests return 500

Possible causes:

- The proxy route points to a backend service that is not running.
- Axios failed while forwarding the request.
- The route exists in the gateway but the target service is unavailable.

Current `/users` and `/payments` demo handlers are defined directly in `src/app.ts`, so local demo routes can respond without external services before the proxy handler is reached.

### Problem: Docker image does not include Lua script

The Dockerfile builds TypeScript and then copies Lua scripts:

```dockerfile
RUN npm run build
RUN cp -r src/lua dist/lua
```

If rate limiting fails at startup because the Lua file is missing, rebuild the image:

```bash
docker compose build --no-cache gateway1 gateway2 gateway3
```

Then start again:

```bash
docker compose up -d
```

### Problem: Metrics are missing in Prometheus

Check that Prometheus targets are up:

```text
http://localhost:9090/targets
```

If targets are down:

- Make sure the gateway containers are running.
- Check `prometheus.yml`.
- Confirm Prometheus uses Docker service names, not host ports.

## Suggested Commit History

This is the clean commit breakdown for the project:

```bash
git add package.json package-lock.json tsconfig.json .gitignore .dockerignore
git commit -m "chore: initialize typescript express project"
```

```bash
git add src/app.ts src/server.ts
git commit -m "feat: add api gateway server"
```

```bash
git add src/router/routeResolver.ts src/router/loadBalancer.ts src/router/proxy.ts
git commit -m "feat: add route resolution and proxy load balancing"
```

```bash
git add src/middleware/auth.middleware.ts
git commit -m "feat: add jwt authentication middleware"
```

```bash
git add src/services/redisClient.ts src/services/rateLimiter.service.ts src/lua/tokenBucket.lua src/middleware/rateLimit.middleware.ts
git commit -m "feat: add redis backed token bucket rate limiter"
```

```bash
git add src/services/metrics.service.ts src/middleware/metrics.middleware.ts prometheus.yml
git commit -m "feat: add prometheus metrics collection"
```

```bash
git add Dockerfile docker-compose.yml
git commit -m "chore: add docker compose environment"
```

```bash
git add load-tests/
git commit -m "test: add k6 load test scenarios"
```

```bash
git add PROJECT_GUIDE.md
git commit -m "docs: add project run and load testing guide"
```

Do not commit `.env`.

## Useful Daily Commands

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start Docker stack:

```bash
docker compose up --build -d
```

Run default k6 test:

```bash
docker compose --profile load-test run --rm k6
```

Run multi-user k6 test explicitly:

```bash
docker compose --profile load-test run --rm k6 run /scripts/multi-user.js
```

Reset Redis:

```bash
docker compose exec redis redis-cli flushall
```

View gateway logs:

```bash
docker compose logs -f gateway1 gateway2 gateway3
```

Stop everything:

```bash
docker compose down
```

Stop everything and clear volumes:

```bash
docker compose down -v
```

## Future Improvements

Good next improvements:

- Move JWT secret into environment variables.
- Add `.env.example`.
- Add route config through JSON or database instead of hardcoded routes.
- Add per-endpoint limits.
- Add better labels to Prometheus metrics, such as method, route, and status code.
- Add integration tests for auth and rate limiting.
- Add real backend demo services for `/users` and `/payments`.
- Add Grafana dashboard provisioning.
- Add a sliding window rate limiter as a second algorithm.
