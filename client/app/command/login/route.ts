import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getClientIp, isSameOriginRequest } from "@/lib/auth/request";
import {
  isCommandCenterEnabled,
  isCommandCenterLoginLocked,
  isValidCommandCenterPassword,
  recordCommandCenterLoginFailure,
  setCommandCenterSessionCookie,
} from "@/lib/command-center-auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (!isCommandCenterEnabled()) {
    redirect("/command?error=disabled");
  }

  const clientIp = getClientIp(request.headers);

  if (isCommandCenterLoginLocked(clientIp)) {
    redirect("/command?error=rate_limited");
  }

  const formData = await request.formData();
  const password = String(formData.get("password") ?? "").slice(0, 256);

  if (!isValidCommandCenterPassword(password)) {
    recordCommandCenterLoginFailure(clientIp);
    redirect("/command?error=invalid_password");
  }

  setCommandCenterSessionCookie();
  redirect("/command");
}
