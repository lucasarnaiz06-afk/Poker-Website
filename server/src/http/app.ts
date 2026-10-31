import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { env } from "../config/env";
import type { TableRuntime } from "../table-runtime";
import { corsOptions } from "./cors";
import { createAdminRouter } from "./routes/admin.routes";
import { healthRouter } from "./routes/health.routes";
import { sessionRouter } from "./routes/session.routes";
import { createTablesRouter, type CookieAuthenticator } from "./routes/tables.routes";

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);

  response.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
  });
};

type CreateAppOptions = {
  getTableRuntime?: () => TableRuntime | null;
  commandCenterPassword?: string | null;
  /** Reverse-proxy hops to trust for X-Forwarded-For (defaults to TRUST_PROXY_HOPS, 0 = never trust XFF). */
  trustProxyHops?: number;
  /** Overrides session-cookie auth for /tables (tests). */
  authenticate?: CookieAuthenticator;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  // request.ip feeds rate limits/lockouts. Only trust X-Forwarded-For when a known number of proxies sit in
  // front of us; otherwise any client could pick its own IP by sending the header.
  const trustProxyHops = options.trustProxyHops ?? env.trustProxyHops;
  app.set("trust proxy", trustProxyHops > 0 ? trustProxyHops : false);
  app.disable("x-powered-by");

  // JSON-only API: lock everything down (no scripts, no framing, no referrer leaks).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "32kb" }));
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/health", healthRouter);
  app.use("/session", sessionRouter);

  if (options.getTableRuntime) {
    app.use(
      "/tables",
      createTablesRouter(options.getTableRuntime, options.authenticate ? { authenticate: options.authenticate } : {}),
    );
    app.use(
      "/admin",
      createAdminRouter(
        options.getTableRuntime,
        options.commandCenterPassword === undefined ? {} : { password: options.commandCenterPassword },
      ),
    );
  }

  app.use(errorHandler);

  return app;
}
