import { NEXTAUTH_SESSION_COOKIE_NAMES } from "@poker-platform/shared/auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/socket.io")) {
    const requestHeaders = new Headers(request.headers);

    requestHeaders.set("ngrok-skip-browser-warning", "true");

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const hasSessionCookie = NEXTAUTH_SESSION_COOKIE_NAMES.some((cookieName) =>
    request.cookies.has(cookieName),
  );

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/auth/signin", request.url);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/lobby/:path*", "/table/:path*", "/socket.io", "/socket.io/:path*"],
};
