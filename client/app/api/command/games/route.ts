import { NextResponse } from "next/server";
import {
  hasCommandCenterSession,
  isCommandCenterEnabled,
} from "@/lib/command-center-auth";
import { fetchCommandCenterUpstream } from "@/lib/command-center-api";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isCommandCenterEnabled()) {
    return NextResponse.json(
      { error: "COMMAND_CENTER_DISABLED" },
      { status: 503 },
    );
  }

  if (!hasCommandCenterSession()) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const upstreamResponse = await fetchCommandCenterUpstream("/games");
    const payload = await upstreamResponse.json();

    return NextResponse.json(payload, {
      status: upstreamResponse.status,
    });
  } catch (error) {
    console.error("Command center list fetch failed", error);

    return NextResponse.json(
      { error: "COMMAND_CENTER_UPSTREAM_ERROR" },
      { status: 502 },
    );
  }
}
