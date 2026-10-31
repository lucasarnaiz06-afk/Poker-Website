import { handsToPokerStars, listMyHandViews, parseHandFilters } from "@poker-platform/shared/hands";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** GET /hands/export?filters: the signed-in user's hands as a PokerStars hand-history file (newest 2,000). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download your hands.", { status: 401 });
  const url = new URL(request.url);
  const filters = parseHandFilters(Object.fromEntries(url.searchParams.entries()));
  const views = await listMyHandViews(user.userId, filters, 2000);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(handsToPokerStars(views), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="felt-hands-${day}.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
