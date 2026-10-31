import { NEXTAUTH_SESSION_COOKIE_NAMES } from "@poker-platform/shared/auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/** Pages that need a signed-in user. Everything except /onboarding also needs a username. */
const PROTECTED_PREFIXES = ["/account", "/onboarding", "/welcome", "/lobby", "/table", "/hands"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectTo(request: NextRequest, pathname: string, callbackUrl?: string) {
  const url = new URL(pathname, request.url);

  if (callbackUrl) {
    url.searchParams.set("callbackUrl", callbackUrl);
  }

  return NextResponse.redirect(url);
}

type AccountStatus = { authenticated: boolean; onboarded: boolean };

/**
 * Asks the Node runtime (Prisma lives there, not in the edge middleware) whether the cookie is a live
 * session and whether onboarding is done. The base URL comes from configuration, never the Host header.
 */
async function fetchAccountStatus(request: NextRequest): Promise<AccountStatus | null> {
  const base = process.env.INTERNAL_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim();

  if (!base) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);

  try {
    const response = await fetch(new URL("/api/auth/account-status", base), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as AccountStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/socket.io")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("ngrok-skip-browser-warning", "true");

    const hasCookie = NEXTAUTH_SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

    if (!hasCookie) {
      return new NextResponse(null, { status: 401 });
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  const callbackUrl = `${pathname}${search}`;
  const hasSessionCookie = NEXTAUTH_SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

  if (!hasSessionCookie) {
    return redirectTo(request, "/auth/signin", callbackUrl);
  }

  const status = await fetchAccountStatus(request);

  if (!status) {
    // Status unavailable: let the page's own server-side checks decide.
    return NextResponse.next();
  }

  if (!status.authenticated) {
    return redirectTo(request, "/auth/signin", callbackUrl);
  }

  const onOnboarding = pathname === "/onboarding" || pathname.startsWith("/onboarding/");

  if (!status.onboarded && !onOnboarding) {
    return redirectTo(request, "/onboarding", callbackUrl);
  }

  if (status.onboarded && onOnboarding) {
    return redirectTo(request, "/lobby");
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account/:path*",
    "/onboarding/:path*",
    "/lobby/:path*",
    "/table/:path*",
    "/hands/:path*",
    "/socket.io",
    "/socket.io/:path*",
  ],
};
