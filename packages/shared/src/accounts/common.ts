import { Prisma } from "@prisma/client";
import type { z } from "zod";

/** Request metadata passed from route handlers/server actions. Never trusted for authorization. */
export type RequestContext = {
  ip: string | null;
  userAgent: string | null;
  /**
   * Origin the request came in on (development only; see getAppBaseUrl). Never set in production, where the
   * Host/Origin headers are attacker-controlled and could poison links in emails.
   */
  appOrigin?: string | null;
};

export type ActionFailure = {
  ok: false;
  error: string;
  code?: string;
  fieldErrors?: Record<string, string>;
};

export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFailure;

export function fail(error: string, code?: string, fieldErrors?: Record<string, string>): ActionFailure {
  return { ok: false, error, ...(code ? { code } : {}), ...(fieldErrors ? { fieldErrors } : {}) };
}

export function zodFailure(error: z.ZodError, message = "Check the highlighted fields."): ActionFailure {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }

  return fail(message, "INVALID_INPUT", fieldErrors);
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  if (!field) {
    return true;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/**
 * Base URL for links in emails. In production always from configuration (never the request Host header,
 * which an attacker controls and could use to poison reset links). In development the origin the request
 * came in on is used when known, so links work even when NEXTAUTH_URL points at a tunnel that is offline.
 */
export function getAppBaseUrl(ctx?: Pick<RequestContext, "appOrigin"> | null): string {
  if (process.env.NODE_ENV !== "production" && ctx?.appOrigin) {
    const origin = safeHttpOrigin(ctx.appOrigin);

    if (origin) {
      return origin;
    }
  }

  const configured = process.env.NEXTAUTH_URL?.trim() || process.env.CLIENT_ORIGIN?.trim() || "http://localhost:3000";
  return configured.replace(/\/+$/, "");
}

/** `value`'s origin when it is an http(s) URL, else null. */
export function safeHttpOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
