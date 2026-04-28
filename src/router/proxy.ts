import axios from "axios";
import { Request, Response } from "express";
import { routes } from "./routeResolver";
import { getNextService } from "./loadBalancer";

export const proxyHandler = async (req: Request, res: Response) => {
  try {
    const path = req.path.split("/")[1];
    const services = routes[`/${path}`];

    if (!services) {
      return res.status(404).json({ message: "Route not found" });
    }

    const target = getNextService(services);

    const response = await axios({
      method: req.method as any,
      url: `${target}${req.originalUrl}`,
      data: req.body,
      headers: req.headers,
    });

    res.status(response.status).json(response.data);
  } catch (err: any) {
    res.status(500).json({
      message: "Service error",
      error: err.message,
    });
  }
};
