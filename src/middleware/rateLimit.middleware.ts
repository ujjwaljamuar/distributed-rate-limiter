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

  const key = userId ? `user:${userId}` : `ip:${req.ip}`;

  try {
    const allowed = await checkRateLimit(key);

    if (!allowed) {
      rateLimitedCounter.inc();

      return res.status(429).json({
        message: "Too many requests",
      });
    }

    next();
  } catch (err) {
    next(); // fail-open
  }
};
