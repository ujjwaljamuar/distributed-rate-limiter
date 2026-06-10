import { Request, Response, NextFunction } from "express";
import { checkRateLimit } from "../services/rateLimiter.service";
import { rateLimitedCounter } from "../services/metrics.service";

import { AuthRequest } from "./auth.middleware";

export const rateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const userId = req.user?.user_id;
  const role = req.user?.role || "free";

  const endpoint = req.path;

  const key = `user:${userId}:${endpoint}`;

  try {
    const allowed = await checkRateLimit(key, role);

    if (!allowed) {
      rateLimitedCounter.inc({
        endpoint: req.path,
        role,
      });

      return res.status(429).json({
        message: "Too many requests",
      });
    }

    next();
  } catch (err) {
    next(); // fail-open
  }
};
