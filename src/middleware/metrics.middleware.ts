import { Request, Response, NextFunction } from "express";
import { requestCounter, requestDuration } from "../services/metrics.service";

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  requestCounter.inc();

  const end = requestDuration.startTimer();

  res.on("finish", () => {
    end();
  });

  next();
};
