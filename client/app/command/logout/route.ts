import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isSameOriginRequest } from "@/lib/auth/request";
import { clearCommandCenterSessionCookie } from "@/lib/command-center-auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  clearCommandCenterSessionCookie();
  redirect("/command");
}
