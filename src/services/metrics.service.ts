import client from "prom-client";

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

export const requestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of requests",
});

export const rateLimitedCounter = new client.Counter({
  name: "rate_limited_total",
  help: "Total number of rate-limited requests",
});

export const requestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Request duration in ms",
  buckets: [10, 50, 100, 200, 500],
});

export const register = client.register;
