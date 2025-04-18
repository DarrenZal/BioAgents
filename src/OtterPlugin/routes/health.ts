// File: routes/health.ts
import { type Route } from "@elizaos/core";

export const health: Route = {
  path: "/otter/health",
  type: "GET",
  handler: async (_req: any, res: any) => {
    res.json({
      status: "OK",
      service: "Otter.ai Plugin",
      version: "1.0.0",
    });
  },
};