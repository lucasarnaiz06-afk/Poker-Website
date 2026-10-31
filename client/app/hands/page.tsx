import { listMyHands, listMyTables, parseHandFilters } from "@poker-platform/shared/hands";
import { ChevronRight, Download, History, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HandFilters } from "@/components/hands/hand-filters";
import { HandList } from "@/components/hands/hand-list";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Button, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Hand history" };

type SearchParams = Record<string, string | string[] | undefined>;

function query(params: SearchParams, patch: Record<string, string | null>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string" && v) out.set(key, v);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) out.delete(key);
    else out.set(key, value);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export default async function HandsPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const { userId } = await requireUser({ callbackUrl: "/hands" });
  const filters = parseHandFilters(searchParams);
  const rawCursor = Array.isArray(searchParams.cursor) ? searchParams.cursor[0] : searchParams.cursor;
  const cursor = typeof rawCursor === "string" && rawCursor.length < 200 ? rawCursor : null;
  const [page, tables] = await Promise.all([listMyHands(userId, filters, { cursor, limit: 25 }), listMyTables(userId)]);
  const filtered = Object.keys(filters).length > 0;
  const exportQuery = query(searchParams, { cursor: null });

  if (!filtered && !cursor && page.rows.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Hand history" description="Every hand you play, ready to replay and share." />
        <Card>
          <EmptyState
            icon={<History />}
            title="Play your first hand to see it here"
            description="Your hands show up here as soon as they finish, with a step-by-step replayer."
            action={
              <Button asChild>
                <Link href="/lobby">Find a table</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Hand history"
        description="Tap a hand to replay it. Results are in chips and big blinds (BB)."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/hands/export${exportQuery}`} download>
              <Download className="h-4 w-4" aria-hidden /> Download (PokerStars format)
            </a>
          </Button>
        }
      />
      <div className="mb-4">
        <HandFilters tables={tables} />
      </div>
      <Card className="overflow-hidden">
        {page.rows.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title="No hands match these filters"
            description="Try a wider date range or clear the filters."
            action={
              <Button asChild variant="secondary">
                <Link href="/hands">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <HandList rows={page.rows} />
        )}
      </Card>
      <div className="mt-4 flex items-center justify-between gap-2">
        {cursor ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/hands${query(searchParams, { cursor: null })}`}>Back to newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {page.nextCursor ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/hands${query(searchParams, { cursor: page.nextCursor })}`}>
              Older hands <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </PageContainer>
  );
}
