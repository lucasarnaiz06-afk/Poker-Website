import { listLobbyTables } from "@poker-platform/shared/lobbies";
import type { LobbyTableSummary } from "@poker-platform/shared/types";
import { ArrowRight, Bomb, History, ShieldCheck, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureBadges } from "@/components/lobby/feature-badges";
import { formatBlinds, VARIANT_SHORT } from "@/components/lobby/format";
import { AUTH_ROUTES } from "@/components/shell/nav-items";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Bomb,
    title: "Live tables with side games",
    body: "Hold'em with friends in real time. Vote in a bomb pot, start a nit game, or put a bounty on 7-2.",
  },
  {
    icon: History,
    title: "Hand histories & stats",
    body: "Replay every hand street by street and see how you really play: VPIP, win rate and more.",
  },
  {
    icon: Trophy,
    title: "Leaderboards",
    body: "Climb the weekly and all-time boards. Bragging rights only, since the chips are play money.",
  },
] as const;

export default async function HomePage() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/lobby");
  }

  // Real public tables (a few); the section is left out when there are none or the DB is unavailable.
  const tables = (await listLobbyTables().catch(() => [])).filter((table) => !table.hasPassword).slice(0, 4);

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--accent)/0.14),transparent_70%)]"
      />
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Free to play · Play-money chips
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            Poker night, without the setup.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-7 text-muted sm:text-lg">
            Open a table, send your friends a link, and play Texas Hold&apos;em in your browser. Bomb pots, nit games
            and 7-2 bounties built in.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={AUTH_ROUTES.signUp}>
                Create a free account
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="w-full sm:w-auto">
              <Link href={AUTH_ROUTES.signIn}>I already have an account</Link>
            </Button>
          </div>
        </div>

        {tables.length > 0 ? <OpenTablesPreview tables={tables} /> : null}
      </section>

      <section aria-labelledby="features-heading" className="border-t border-line bg-surface/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="features-heading" className="sr-only">
            Features
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
              </li>
            ))}
          </ul>

          <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-2xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:p-8">
            <div>
              <p className="text-lg font-semibold text-fg">Ready for a hand?</p>
              <p className="mt-1 text-sm text-muted">New players start with 10,000 free chips.</p>
            </div>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={AUTH_ROUTES.signUp}>Sign up free</Link>
            </Button>
          </div>

          <p className="mt-8 flex items-center gap-2 text-xs text-subtle">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Fair, verifiable shuffles. No purchases, no cash-outs, no real-money gambling.
          </p>
        </div>
      </section>
    </div>
  );
}

/** A few real public tables. Joining needs an account, so each row goes through sign-in to that table. */
function OpenTablesPreview({ tables }: { tables: LobbyTableSummary[] }) {
  return (
    <section aria-labelledby="open-tables-preview" className="mx-auto mt-14 max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-panel">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id="open-tables-preview" className="text-sm font-medium text-fg">
            Public tables open now
          </h2>
          <span className="text-xs text-muted">Sign in to join</span>
        </div>
        <ul className="divide-y divide-line">
          {tables.map((table) => (
            <li key={table.tableId} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{table.name}</p>
                <p className="tabular mt-0.5 text-xs text-muted">
                  {VARIANT_SHORT[table.variant]} · {formatBlinds(table)}
                </p>
                <FeatureBadges features={table.features} className="mt-1.5 flex flex-wrap gap-1" />
              </div>
              <span className="tabular hidden items-center gap-1 text-sm text-muted sm:inline-flex">
                <Users className="h-3.5 w-3.5" aria-hidden />
                {table.maxPlayers} seats
              </span>
              <Button asChild size="sm">
                <Link href={`${AUTH_ROUTES.signIn}?callbackUrl=${encodeURIComponent(`/lobby/${table.tableId}`)}`}>
                  Join<span className="sr-only"> {table.name}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
