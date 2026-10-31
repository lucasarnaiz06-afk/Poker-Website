import nextEnv from "@next/env";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(clientDir, "..");
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const { updateInitialEnv } = nextEnv;

const isDev = process.env.NODE_ENV !== "production";

/**
 * The real env files live at the workspace root. `loadEnvConfig(workspaceRoot)` is a no-op here because Next
 * already called it for client/ and caches the first result, so load them ourselves (same precedence as
 * Next, never overriding variables that are already set) and register them as part of the initial env so
 * Next's dev-time env reloads don't drop them.
 */
function loadWorkspaceEnv() {
  const mode = process.env.NODE_ENV === "test" ? "test" : isDev ? "development" : "production";
  const files = [`.env.${mode}.local`, mode !== "test" && ".env.local", `.env.${mode}`, ".env"].filter(Boolean);
  const loaded = {};
  for (const file of files) {
    const path = resolve(workspaceRoot, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (process.env[key] === undefined && loaded[key] === undefined) loaded[key] = value;
    }
  }
  Object.assign(process.env, loaded);
  updateInitialEnv(loaded);
}

loadWorkspaceEnv();

function originOf(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy.
 * - Scripts: Next's App Router inlines bootstrap scripts and the theme init script, so 'unsafe-inline' is
 *   needed without a nonce-based setup; dev additionally needs 'unsafe-eval' for React Refresh.
 * - connect-src: same origin (socket.io goes through the /socket.io rewrite), plus NEXT_PUBLIC_SOCKET_URL
 *   when the browser connects to the game server directly, plus ws: in dev for HMR.
 */
function contentSecurityPolicy() {
  const socketOrigin = originOf(process.env.NEXT_PUBLIC_SOCKET_URL?.trim());
  const socketWsOrigin = socketOrigin ? socketOrigin.replace(/^http/, "ws") : null;
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(googleEnabled ? ["https://lh3.googleusercontent.com"] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(socketOrigin ? [socketOrigin, socketWsOrigin] : []),
      ...(isDev ? ["ws:", "wss:"] : []),
    ],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...(googleEnabled ? ["https://accounts.google.com"] : [])],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`)
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

function securityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];

  if (!isDev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }

  return headers;
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Lets parallel dev servers / builds use separate output dirs (e.g. NEXT_DIST_DIR=.next-dev-table).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  env: {
    // Empty = open sign-up (any email domain).
    NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS:
      process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? "",
  },
  experimental: {
    // Native argon2 binding must be required at runtime, not bundled.
    serverComponentsExternalPackages: ["@node-rs/argon2"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  async rewrites() {
    const socketUrl =
      process.env.SOCKET_SERVER_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
      "http://localhost:4000";

    return [
      {
        source: "/socket.io",
        destination: `${socketUrl}/socket.io/`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${socketUrl}/socket.io/:path*`,
      },
    ];
  },
  transpilePackages: ["@poker-platform/shared", "@poker-platform/engine"],
};

export default nextConfig;
