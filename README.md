# Distributed API Gateway Rate Limiting

A TypeScript and Express based API gateway that demonstrates distributed rate limiting across multiple gateway instances using Redis, Lua scripting, Docker Compose, Prometheus, Grafana, and k6.

The project shows how an API gateway can centralize common backend concerns such as authentication, rate limiting, routing, metrics, and load testing.

## Features

- Express API gateway written in TypeScript
- JWT authentication middleware
- Redis-backed distributed token bucket rate limiter
- Atomic rate limit updates using Redis Lua scripts
- Multiple gateway instances running with Docker Compose
- Basic route resolution and proxy forwarding
- Simple round-robin service selection
- Prometheus metrics endpoint
- Grafana-ready monitoring setup
- k6 load tests for single-user, multi-user, and mixed traffic scenarios

## Architecture

```text
Client / k6
   |
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
   | metrics scraped from gateways
   v
+-------------------+      +-------------------+
| Prometheus        | ---> | Grafana           |
+-------------------+      +-------------------+
```

Each gateway instance is stateless. Rate limit state is stored in Redis, so requests sent to different gateway containers still share the same limit.

## How It Works

For a protected request, the gateway flow is:

```text
Request
  -> metrics middleware
  -> JWT authentication
  -> Redis token bucket rate limiter
  -> local route or proxy handler
  -> response
```

The `/metrics` endpoint is exposed before authentication so Prometheus can scrape it directly.

## Distributed Rate Limiting

The project uses a token bucket algorithm.

Current settings:

```ts
const maxTokens = 10;
const refillRate = 1; // token per second
```

Each request consumes one token. If a user has no tokens left, the gateway returns:

```http
429 Too Many Requests
```

Redis stores two keys per user or IP:

```text
tokens:<key>
timestamp:<key>
```

The key is based on the authenticated user when available:

```text
user:<user_id>
```

Redis Lua scripting is used so the read, refill, consume, and write steps happen atomically. This prevents race conditions when multiple gateway instances process requests for the same user at the same time.

## Tech Stack

- Node.js
- TypeScript
- Express
- Redis
- ioredis
- JSON Web Tokens
- Axios
- prom-client
- Docker Compose
- Prometheus
- Grafana
- k6

## Project Structure

```text
src/
  app.ts                         Express app and middleware setup
  server.ts                      Server startup
  middleware/
    auth.middleware.ts           JWT authentication
    rateLimit.middleware.ts      Rate limiting middleware
    metrics.middleware.ts        Prometheus metrics middleware
  services/
    redisClient.ts               Redis connection
    rateLimiter.service.ts       Redis Lua rate limiter integration
    metrics.service.ts           Prometheus metric definitions
  router/
    routeResolver.ts             Route map
    loadBalancer.ts              Round-robin target selection
    proxy.ts                     Proxy handler
  lua/
    tokenBucket.lua              Atomic token bucket script

load-tests/
  config.js                      k6 target URLs and tokens
  options.js                     k6 load options
  single-user.js                 Single-user load test
  multi-user.js                  Multi-user load test
  mixed-traffic.js               Mixed traffic test

docker-compose.yml               Redis, gateways, Prometheus, Grafana, k6
Dockerfile                       Gateway image build
prometheus.yml                   Prometheus scrape config
```

## Getting Started

### Prerequisites

- Node.js
- npm
- Docker
- Docker Compose

### Install Dependencies

```bash
npm install
```

### Run Locally

Start Redis locally first:

```bash
docker run --name local-rate-limit-redis -p 6379:6379 redis:7-alpine
```

Then start the gateway:

```bash
npm run dev
```

The local gateway runs at:

```text
http://localhost:3000
```

## Run With Docker Compose

Build and start the full stack:

```bash
docker compose up --build -d
```

Gateway instances:

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

Stop the stack:

```bash
docker compose down
```

Stop the stack and remove volumes:

```bash
docker compose down -v
```

## API Usage

Protected routes require a JWT:

```http
Authorization: Bearer <jwt-token>
```

Example:

```bash
curl -H "Authorization: Bearer <jwt-token>" http://localhost:3000/users
```

Demo routes:

```text
GET /users
GET /payments
GET /metrics
```

The `/metrics` route does not require authentication.

## Load Testing

The `k6` service is behind the Docker Compose `load-test` profile.

Run the default load test:

```bash
docker compose --profile load-test run --rm k6
```

Run a specific test:

```bash
docker compose --profile load-test run --rm k6 run /scripts/single-user.js
docker compose --profile load-test run --rm k6 run /scripts/multi-user.js
docker compose --profile load-test run --rm k6 run /scripts/mixed-traffic.js
```

Reset Redis state before a fresh test:

```bash
docker compose exec redis redis-cli flushall
docker compose --profile load-test run --rm k6
```

Inside Docker, k6 calls the gateway containers using service names:

```text
http://gateway1:3000
http://gateway2:3000
http://gateway3:3000
```

## Monitoring

Prometheus scrapes metrics from all three gateway instances.

Useful Prometheus queries:

```text
http_requests_total
rate(http_requests_total[1m])
rate_limited_total
rate(rate_limited_total[1m])
http_request_duration_ms_count
```

Grafana can use Prometheus as a data source:

```text
http://prometheus:9090
```

Use the Docker service name `prometheus` because Grafana runs inside the Compose network.

## Useful Commands

Build TypeScript:

```bash
npm run build
```

Run in development mode:

```bash
npm run dev
```

Format files:

```bash
npm run format
```

Check formatting:

```bash
npm run format:check
```

View gateway logs:

```bash
docker compose logs -f gateway1 gateway2 gateway3
```

Check Redis:

```bash
docker compose exec redis redis-cli ping
```

Inspect rate limit keys:

```bash
docker compose exec redis redis-cli keys "*"
```

## Current Limitations

- JWT secret is currently hardcoded.
- Route configuration is hardcoded.
- Demo backend routes are implemented directly in the gateway.
- Proxy targets are examples and do not include separate backend services.
- Metrics do not yet include labels such as route, method, or status code.
- Redis keys do not currently expire automatically.
- Automated tests are not yet included.

## Future Improvements

- Move secrets into environment variables.
- Add `.env.example`.
- Add Redis key expiry for inactive users.
- Add per-route and per-user-plan rate limits.
- Add route, method, and status labels to metrics.
- Add backend health checks.
- Add retries, timeouts, and circuit breaker behavior.
- Add integration tests for authentication and rate limiting.
- Add Grafana dashboard provisioning.

## Core Idea

The key lesson of this project is that rate limiting changes when an application becomes distributed.

An in-memory limiter may work for one server, but it becomes incorrect when traffic is spread across many instances. By storing token bucket state in Redis and updating it atomically with Lua, this gateway enforces one shared rate limit across multiple running containers.
