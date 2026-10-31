import { NextResponse } from "next/server";
import {
  hasCommandCenterSession,
  isCommandCenterEnabled,
} from "@/lib/command-center-auth";
import { fetchCommandCenterUpstream } from "@/lib/command-center-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    lobbyId: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
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
    const upstreamResponse = await fetchCommandCenterUpstream(
      `/games/${encodeURIComponent(context.params.lobbyId)}`,
    );
    const payload = await upstreamResponse.json();

    return NextResponse.json(payload, {
      status: upstreamResponse.status,
    });
  } catch (error) {
    console.error("Command center detail fetch failed", error);

    return NextResponse.json(
      { error: "COMMAND_CENTER_UPSTREAM_ERROR" },
      { status: 502 },
    );
  }
}
