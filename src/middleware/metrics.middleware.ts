import { Request, Response, NextFunction } from "express";
import { requestCounter } from "../services/metrics.service";

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.on("finish", () => {
    requestCounter.inc({
      method: req.method,
      endpoint: req.path,
      status: res.statusCode.toString(),
    });
  });

  next();
};
