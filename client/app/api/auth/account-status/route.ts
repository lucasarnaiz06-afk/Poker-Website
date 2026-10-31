import { getAuthenticatedSessionFromToken, touchUserLastSeen } from "@poker-platform/shared/auth";
import { NextResponse } from "next/server";
import { getSessionTokenFromRequestCookies } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * Lightweight session check used by middleware (edge) to gate protected routes and send users without a
 * username to onboarding. Returns no personal data.
 */
export async function GET() {
  const session = await getAuthenticatedSessionFromToken(getSessionTokenFromRequestCookies());

  if (!session) {
    return NextResponse.json({ authenticated: false, onboarded: false }, { headers: { "Cache-Control": "no-store" } });
  }

  void touchUserLastSeen(session.user.id).catch(() => undefined);

  return NextResponse.json(
    { authenticated: true, onboarded: Boolean(session.user.username) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
