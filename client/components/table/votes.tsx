"use client";

import { TABLE_FEATURE_DESCRIPTIONS } from "@poker-platform/shared/lobbies/client";
import type { TableVote, TableView, VoteKind } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bomb, Check, Shuffle, Sparkles, Turtle, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { sideGameExplainer, VOTE_KIND_LABEL, voteRuleLabel, voteTitle } from "./format";
import { votesNeeded } from "./logic";
import type { TableCommands } from "./table-controller";

export const VOTE_ICON: Record<VoteKind, ReactNode> = {
  BOMB_POT: <Bomb aria-hidden />,
  NIT_GAME: <Turtle aria-hidden />,
  BOUNTY_GAME: <span aria-hidden className="text-[11px] font-bold">7·2</span>,
  RUN_IT_TWICE: <Shuffle aria-hidden />,
};

export function VoteCard({
  vote,
  view,
  now,
  commands,
  inline = false,
}: {
  vote: TableVote;
  view: TableView;
  now: number;
  commands: TableCommands;
  /** Flat variant used inside the action dock. */
  inline?: boolean;
}) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const me = view.viewer.userId;
  const eligible = vote.eligibleUserIds.includes(me);
  const myVote = vote.yesUserIds.includes(me) ? "yes" : vote.noUserIds.includes(me) ? "no" : null;
  const needed = votesNeeded(vote);
  const yes = vote.yesUserIds.length;
  const no = vote.noUserIds.length;
  const total = Math.max(1, Date.parse(vote.expiresAt) - Date.parse(vote.createdAt));
  const left = Math.max(0, Date.parse(vote.expiresAt) - now);
  const seconds = Math.ceil(left / 1000);
  const rit = vote.kind === "RUN_IT_TWICE";
  const open = vote.status === "OPEN";

  const cast = async (value: boolean) => {
    setBusy(value ? "yes" : "no");
    await commands.vote(vote.id, value);
    setBusy(null);
  };

  const pending = vote.eligibleUserIds
    .filter((id) => !vote.yesUserIds.includes(id) && !vote.noUserIds.includes(id))
    .map((id) => view.seats.find((s) => s.userId === id)?.displayName ?? "Player");

  if (inline) {
    // Compact one-row layout that fits the action dock without changing its height.
    return (
      <section
        aria-label={`${VOTE_KIND_LABEL[vote.kind]} vote`}
        className={cn(
          "pointer-events-auto flex w-full animate-rise-in flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2.5",
          rit ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-surface/95 shadow-pop backdrop-blur",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4",
              rit ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning",
            )}
          >
            {VOTE_ICON[vote.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{voteTitle(vote.kind, vote.action)}</h3>
              {open && (
                <span className={cn("text-xs tabular", seconds <= 5 ? "text-danger" : "text-muted")} aria-label={`${seconds} seconds left`}>
                  {seconds}s
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-xs text-muted">
              {rit ? "Deal the rest twice and split the pot" : `${vote.proposedByName} proposed`} · {voteRuleLabel(vote.rule)} ·{" "}
              <span className="tabular">
                {yes}/{needed} yes
              </span>
            </p>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {!open ? (
            <p className={cn("text-sm font-medium", vote.status === "PASSED" ? "text-accent" : "text-danger")} role="status">
              {vote.status === "PASSED" ? (rit ? "Running it twice" : "Vote passed") : rit ? "Running it once" : "Vote failed"}
            </p>
          ) : myVote || !eligible ? (
            <p className="truncate text-xs text-muted">
              {myVote ? `You voted ${rit ? (myVote === "yes" ? "twice" : "once") : myVote}.` : "Seated players are voting."}
              {pending.length > 0 && ` Waiting for ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? ` +${pending.length - 3}` : ""}`}
            </p>
          ) : (
            <>
              <Button size={rit ? "md" : "sm"} variant="secondary" className="flex-1 sm:flex-none" onClick={() => void cast(false)} loading={busy === "no"}>
                {rit ? "Once" : "No"}
              </Button>
              <Button
                size={rit ? "md" : "sm"}
                className="flex-1 sm:flex-none"
                onClick={() => void cast(true)}
                loading={busy === "yes"}
                leftIcon={rit ? <Shuffle /> : <Check />}
              >
                {rit ? "Run it twice" : "Yes"}
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={`${VOTE_KIND_LABEL[vote.kind]} vote`}
      className={cn(
        "pointer-events-auto w-full animate-rise-in overflow-hidden rounded-xl border bg-surface/95 shadow-pop backdrop-blur",
        rit && open ? "border-accent/50" : "border-line",
      )}
    >
      <div className="flex items-start gap-3 px-3.5 pb-2 pt-3">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4",
            rit ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning",
          )}
        >
          {VOTE_ICON[vote.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{voteTitle(vote.kind, vote.action)}</h3>
            {open && (
              <span className={cn("shrink-0 text-xs tabular", seconds <= 5 ? "text-danger" : "text-muted")} aria-label={`${seconds} seconds left`}>
                {seconds}s
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            {rit ? "All-in players decide. " : `${vote.proposedByName} proposed · `}
            {voteRuleLabel(vote.rule)}
          </p>
          {vote.action === "START" && (
            <p className="mt-1 text-xs leading-5 text-subtle">{sideGameExplainer(vote.kind, view.settings)}</p>
          )}
        </div>
      </div>

      {/* Tally */}
      <div className="px-3.5">
        <div className="flex items-center justify-between text-[11px] text-muted tabular">
          <span>
            <span className="font-semibold text-accent">{yes}</span> yes · <span className="font-semibold text-danger">{no}</span> no
          </span>
          <span>{needed} needed</span>
        </div>
        <div
          className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Yes votes"
          aria-valuemin={0}
          aria-valuemax={needed}
          aria-valuenow={Math.min(yes, needed)}
        >
          <div className="bg-accent transition-[width] duration-200" style={{ width: `${Math.min(100, (yes / needed) * 100)}%` }} />
        </div>
        {open && (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full bg-muted/50 transition-[width] duration-200 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3.5 pb-3 pt-2.5">
        {!open ? (
          <p className={cn("text-sm font-medium", vote.status === "PASSED" ? "text-accent" : "text-danger")} role="status">
            {vote.status === "PASSED" ? (rit ? "Running it twice" : "Vote passed") : rit ? "Running it once" : "Vote failed"}
          </p>
        ) : eligible && !myVote ? (
          <>
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => void cast(false)} loading={busy === "no"} leftIcon={<X />}>
              {rit ? "Once" : "No"}
            </Button>
            <Button size="sm" className="flex-1" onClick={() => void cast(true)} loading={busy === "yes"} leftIcon={<Check />}>
              {rit ? "Run it twice" : "Yes"}
            </Button>
          </>
        ) : (
          <p className="truncate text-xs text-muted">
            {myVote ? `You voted ${myVote === "yes" ? "yes" : "no"}. ` : "Seated players are voting. "}
            {pending.length > 0 && `Waiting for ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? ` +${pending.length - 3}` : ""}`}
          </p>
        )}
      </div>
    </section>
  );
}

export function VoteStack({
  view,
  now,
  commands,
  className,
  exclude,
  inline = false,
}: {
  view: TableView;
  now: number;
  commands: TableCommands;
  className?: string;
  /** Vote rendered elsewhere (e.g. the run-it-twice prompt in the action dock). */
  exclude?: string | null;
  /** Compact one-row cards (phones). */
  inline?: boolean;
}) {
  // Run-it-twice first: it blocks the hand.
  const votes = view.votes
    .filter((v) => v.id !== exclude)
    .sort((a, b) => Number(b.kind === "RUN_IT_TWICE") - Number(a.kind === "RUN_IT_TWICE"));
  if (votes.length === 0) return null;
  return (
    <div className={cn("pointer-events-none flex flex-col gap-2", className)} aria-live="polite">
      {votes.map((v) => (
        <VoteCard key={v.id} vote={v} view={view} now={now} commands={commands} inline={inline} />
      ))}
    </div>
  );
}

type GameOption = { kind: Exclude<VoteKind, "RUN_IT_TWICE">; action: "START" | "STOP"; label: string; disabledReason: string | null };

export function gameOptions(view: TableView): GameOption[] {
  const s = view.settings;
  const seated = view.viewer.seat !== null;
  const openKinds = new Set(view.votes.filter((v) => v.status === "OPEN").map((v) => v.kind));
  const why = (kind: VoteKind): string | null =>
    !seated ? "Take a seat to propose" : openKinds.has(kind) ? "Vote in progress" : null;
  const out: GameOption[] = [];
  if (s.bombPot.enabled) {
    out.push({
      kind: "BOMB_POT",
      action: "START",
      label: "Bomb pot next hand",
      disabledReason: view.sideGames.bombPotQueued ? "Already queued" : why("BOMB_POT"),
    });
  }
  if (s.nitGame.enabled) {
    const active = view.sideGames.nitGame.active;
    out.push({ kind: "NIT_GAME", action: active ? "STOP" : "START", label: active ? "Stop nit game" : "Start nit game", disabledReason: why("NIT_GAME") });
  }
  if (s.bountyGame.enabled) {
    const active = view.sideGames.bountyGame.active;
    out.push({
      kind: "BOUNTY_GAME",
      action: active ? "STOP" : "START",
      label: active ? "Stop 7-2 bounty" : "Start 7-2 bounty",
      disabledReason: why("BOUNTY_GAME"),
    });
  }
  return out;
}

export function GamesMenu({ view, commands, compact }: { view: TableView; commands: TableCommands; compact?: boolean }) {
  const options = gameOptions(view);
  if (options.length === 0) return null;
  const s = view.settings;
  const rule = (kind: GameOption["kind"]) =>
    voteRuleLabel(kind === "BOMB_POT" ? s.bombPot.voteRule : kind === "NIT_GAME" ? s.nitGame.voteRule : s.bountyGame.voteRule);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Table games" leftIcon={<Sparkles />} className={cn(compact && "w-8 px-0")}>
          {compact ? null : "Games"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 max-w-[calc(100vw-16px)]" data-theme="dark">
        <DropdownMenuLabel>Propose to the table · everyone votes</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuItem
            key={o.kind}
            icon={<span className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{VOTE_ICON[o.kind]}</span>}
            disabled={Boolean(o.disabledReason)}
            onSelect={() => void commands.propose(o.kind, o.action)}
            className="h-auto items-start py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span>{o.label}</span>
              <span className="whitespace-normal text-xs leading-4 text-muted">{TABLE_FEATURE_DESCRIPTIONS[o.kind]}</span>
              <span className="mt-0.5 text-[11px] text-subtle">{o.disabledReason ?? rule(o.kind)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
