import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { corsOptions } from "./cors";
import { healthRouter } from "./routes/health.routes";
import { sessionRouter } from "./routes/session.routes";

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);

  response.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
  });
};

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "32kb" }));

  app.use("/health", healthRouter);
  app.use("/session", sessionRouter);
  app.use(errorHandler);

  return app;
}
