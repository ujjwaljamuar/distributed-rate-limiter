import express from "express";
import { authMiddleware } from "./middleware/auth.middleware";
import { rateLimiter } from "./middleware/rateLimit.middleware";
import { metricsMiddleware } from "./middleware/metrics.middleware";
import { proxyHandler } from "./router/proxy";
import { register } from "./services/metrics.service";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Order matters
app.use(metricsMiddleware);
app.use(authMiddleware);
app.use(rateLimiter);

app.get("/users", (req, res) => {
  res.json({ users: ["Ujjwal", "Rahul"] });
});

app.get("/payments", (req, res) => {
  res.json({ payments: [100, 200] });
});

app.use(proxyHandler);

export default app;
