import client from "prom-client";

client.collectDefaultMetrics();

export const requestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total requests",
  labelNames: ["method", "endpoint", "status"],
});

export const rateLimitedCounter = new client.Counter({
  name: "rate_limited_total",
  help: "Rate limited requests",
  labelNames: ["endpoint", "role"],
});

export const requestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Request duration in ms",
  buckets: [10, 50, 100, 200, 500],
});

export const register = client.register;
