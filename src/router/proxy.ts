import axios from "axios";
import { Request, Response } from "express";
import { routes } from "./routeResolver";
import { getNextService } from "./loadBalancer";
import { retryRequest } from "../utils/retry.util";
import { recordFailure, recordSuccess } from "../services/circuitBreaker";

export const proxyHandler = async (req: Request, res: Response) => {
  let target: string | undefined;

  try {
    const path = req.path.split("/")[1];
    const services = routes[`/${path}`];

    if (!services) {
      return res.status(404).json({ message: "Route not found" });
    }

    target = getNextService(services); // assign here

    const response = await retryRequest(() =>
      axios({
        method: req.method as any,
        url: `${target}${req.originalUrl}`,
        data: req.body,
        headers: req.headers,
        timeout: 2000,
      }),
    );

    recordSuccess(target);

    res.status(response.status).json(response.data);
  } catch (err: any) {
    if (target) {
      recordFailure(target);
    }

    res.status(500).json({
      message: "Service error after retries",
    });
  }
};
