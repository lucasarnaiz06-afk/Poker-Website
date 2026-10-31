import { exportUserData } from "@poker-platform/shared/accounts";
import { NextResponse } from "next/server";
import { getRequestContext, isSameOriginRequest } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Data export (GDPR-style). Same-origin only; never cached. */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await exportUserData(user.userId, getRequestContext());

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filename = `poker-account-${user.account.username ?? user.userId}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
