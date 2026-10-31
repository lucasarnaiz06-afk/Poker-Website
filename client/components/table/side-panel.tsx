"use client";

import type { ChatMessage, TableLogEntry, TableView, VoteKind } from "@poker-platform/shared/types";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Info, MessageSquare, ScrollText, SendHorizontal, Smile } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { avatarHue, formatBlinds, formatChips, formatSigned, sideGameExplainer, variantLabel, voteRuleLabel } from "./format";
import type { HandSummary } from "./hooks";
import { PlayingCard } from "./playing-card";
import { CHAT_MAX_LENGTH, type TableCommands } from "./table-controller";
import { VOTE_ICON } from "./votes";

export type PanelTab = "chat" | "log" | "hands" | "info";

export function SidePanel({
  view,
  chat,
  hands,
  commands,
  tab,
  onTabChange,
  unreadChat,
}: {
  view: TableView;
  chat: ChatMessage[];
  hands: HandSummary[];
  commands: TableCommands;
  tab: PanelTab;
  onTabChange: (t: PanelTab) => void;
  unreadChat: number;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as PanelTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0 overflow-y-hidden px-2">
        <TabsTrigger value="chat" className="px-2.5">
          <MessageSquare className="h-4 w-4" aria-hidden /> Chat
          {unreadChat > 0 && tab !== "chat" && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-accent-fg tabular" aria-label={`${unreadChat} unread`}>
              {unreadChat > 9 ? "9+" : unreadChat}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="log" className="px-2.5">
          <ScrollText className="h-4 w-4" aria-hidden /> Log
        </TabsTrigger>
        <TabsTrigger value="hands" className="px-2.5">
          <History className="h-4 w-4" aria-hidden /> Hands
        </TabsTrigger>
        <TabsTrigger value="info" className="px-2.5">
          <Info className="h-4 w-4" aria-hidden /> Info
        </TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="min-h-0 flex-1 pt-0 data-[state=active]:flex">
        <ChatPanel view={view} chat={chat} commands={commands} />
      </TabsContent>
      <TabsContent value="log" className="min-h-0 flex-1 pt-0 data-[state=active]:flex">
        <LogPanel entries={view.log} />
      </TabsContent>
      <TabsContent value="hands" className="min-h-0 flex-1 overflow-y-auto pt-0">
        <HandsPanel hands={hands} />
      </TabsContent>
      <TabsContent value="info" className="min-h-0 flex-1 overflow-y-auto pt-0">
        <InfoPanel view={view} />
      </TabsContent>
    </Tabs>
  );
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll };
}

const EMOTE_IDS = Array.from({ length: 52 }, (_, i) => String(i + 1));

function ChatPanel({ view, chat, commands }: { view: TableView; chat: ChatMessage[]; commands: TableCommands }) {
  const [draft, setDraft] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const { ref, onScroll } = useStickToBottom(chat.length);
  const inputRef = useRef<HTMLInputElement>(null);
  const enabled = view.settings.chatEnabled;

  const send = async (payload: { text?: string; emoteId?: string }) => {
    if (cooldown) return;
    setCooldown(true);
    const res = await commands.chat(payload);
    if (res.ok && payload.text) setDraft("");
    window.setTimeout(() => setCooldown(false), 700);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite" aria-label="Chat messages">
        {chat.length === 0 ? (
          <p className="mt-8 text-center text-sm text-subtle">{enabled ? "No messages yet. Say hi!" : "Chat is turned off at this table."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {chat.map((m) => (
              <li key={m.id} className="text-sm leading-5">
                <span className="font-semibold" style={{ color: `hsl(${avatarHue(m.userId)} 60% 72%)` }}>
                  {m.userId === view.viewer.userId ? "You" : m.displayName}
                </span>
                {m.emoteId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/emotes/${encodeURIComponent(m.emoteId)}.png`}
                    alt={`emote ${m.emoteId}`}
                    className="pixelated mt-1 block h-10 w-10"
                    draggable={false}
                  />
                ) : (
                  <span className="break-words text-fg/90"> {m.text}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {enabled && (
        <form
          className="flex shrink-0 items-center gap-1.5 border-t border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (text) void send({ text });
          }}
        >
          <Popover open={emotesOpen} onOpenChange={setEmotesOpen}>
            <PopoverTrigger
              type="button"
              aria-label="Emotes"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Smile className="h-[18px] w-[18px]" aria-hidden />
            </PopoverTrigger>
            <PopoverContent data-theme="dark" side="top" align="start" className="w-[296px] p-2 text-fg">
              <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto" role="list" aria-label="Pick an emote">
                {EMOTE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    disabled={cooldown}
                    onClick={() => {
                      setEmotesOpen(false);
                      void send({ emoteId: id });
                      inputRef.current?.focus();
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    aria-label={`Send emote ${id}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/emotes/${id}.png`} alt="" className="pixelated h-7 w-7" draggable={false} loading="lazy" />
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MAX_LENGTH))}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Message"
              aria-label="Chat message"
              className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-3 pr-12 text-sm text-fg outline-none placeholder:text-subtle focus:border-accent/70 focus:ring-2 focus:ring-accent/25"
            />
            {draft.length > CHAT_MAX_LENGTH - 40 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-subtle tabular" aria-live="polite">
                {CHAT_MAX_LENGTH - draft.length}
              </span>
            )}
          </div>
          <button
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim() || cooldown}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-opacity hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
}

const KIND_DOT: Record<TableLogEntry["kind"], string> = {
  system: "bg-subtle",
  action: "bg-info",
  deal: "bg-muted",
  showdown: "bg-gold",
  award: "bg-gold",
  vote: "bg-warning",
  side_game: "bg-warning",
  seat: "bg-subtle",
};

function LogPanel({ entries }: { entries: TableLogEntry[] }) {
  const { ref, onScroll } = useStickToBottom(entries.length);
  const groups = useMemo(() => {
    const out: Array<{ hand: number | null; items: TableLogEntry[] }> = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.hand === e.handNumber) last.items.push(e);
      else out.push({ hand: e.handNumber, items: [e] });
    }
    return out;
  }, [entries]);
  if (entries.length === 0) {
    return <p className="mt-8 w-full text-center text-sm text-subtle">Nothing has happened yet.</p>;
  }
  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 w-full flex-1 overflow-y-auto px-3 py-3">
      {groups.map((g, i) => (
        <section key={i} className="mb-3" aria-label={g.hand !== null ? `Hand ${g.hand}` : "Table"}>
          {g.hand !== null && (
            <h4 className="sticky top-0 -mx-3 mb-1 bg-surface/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-subtle backdrop-blur">
              Hand #{g.hand}
            </h4>
          )}
          <ul className="flex flex-col gap-1">
            {g.items.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[13px] leading-5">
                <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", KIND_DOT[e.kind])} aria-hidden />
                <span className="min-w-0 flex-1 text-fg/90">{e.text}</span>
                <time className="shrink-0 text-[11px] text-subtle tabular" dateTime={e.at}>
                  {formatTime(e.at)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function HandsPanel({ hands }: { hands: HandSummary[] }) {
  if (hands.length === 0) {
    return (
      <div className="mt-8 px-6 text-center">
        <p className="text-sm text-muted">No finished hands yet.</p>
        <p className="mt-1 text-xs text-subtle">Hands you see this session show up here.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {hands.map((h) => (
        <li key={h.handId} className="px-3 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-muted">
              Hand #{h.handNumber}
              {h.bombPot && <span className="ml-1.5 text-warning">Bomb pot</span>}
            </span>
            {h.viewerNet !== null && (
              <span className={cn("font-semibold tabular", h.viewerNet > 0 ? "text-accent" : h.viewerNet < 0 ? "text-danger" : "text-muted")}>
                {formatSigned(h.viewerNet)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-5">
            {h.winners.map((w, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-medium">{w.name}</span> won <span className="text-gold tabular">{formatChips(w.amount)}</span>
                {w.handName && <span className="text-muted"> with {w.handName}</span>}
              </span>
            ))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {h.viewerCards && (
              <div className="flex gap-0.5" aria-label="Your cards">
                {h.viewerCards.map((c, i) => (
                  <PlayingCard key={i} card={c} width={22} />
                ))}
              </div>
            )}
            {h.boards.map((b, bi) =>
              b.length ? (
                <div key={bi} className="flex gap-0.5" aria-label={h.boards.length > 1 ? `Board ${bi + 1}` : "Board"}>
                  {b.map((c, i) => (
                    <PlayingCard key={i} card={c} width={22} />
                  ))}
                </div>
              ) : null,
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium tabular">{value}</dd>
    </div>
  );
}

function InfoPanel({ view }: { view: TableView }) {
  const s = view.settings;
  const games: Array<{ kind: VoteKind; enabled: boolean; active: boolean; rule: string | null }> = [
    { kind: "BOMB_POT", enabled: s.bombPot.enabled, active: view.sideGames.bombPotQueued, rule: voteRuleLabel(s.bombPot.voteRule) },
    { kind: "NIT_GAME", enabled: s.nitGame.enabled, active: view.sideGames.nitGame.active, rule: voteRuleLabel(s.nitGame.voteRule) },
    { kind: "BOUNTY_GAME", enabled: s.bountyGame.enabled, active: view.sideGames.bountyGame.active, rule: voteRuleLabel(s.bountyGame.voteRule) },
    { kind: "RUN_IT_TWICE", enabled: s.runItTwice, active: false, rule: "All-in players must agree" },
  ];
  const labels: Record<VoteKind, string> = { BOMB_POT: "Bomb pot", NIT_GAME: "Nit game", BOUNTY_GAME: "7-2 bounty", RUN_IT_TWICE: "Run it twice" };
  return (
    <div className="flex flex-col gap-5 px-3 py-3">
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Game</h4>
        <dl className="mt-1 divide-y divide-line/60">
          <Row label="Game" value={variantLabel(s.variant)} />
          <Row label="Blinds" value={formatBlinds(s)} />
          <Row label="Buy-in" value={`${formatChips(s.minBuyIn)} – ${formatChips(s.maxBuyIn)}`} />
          <Row label="Seats" value={`${view.seats.length} / ${s.maxPlayers}`} />
          <Row label="Time to act" value={`${s.actionTimeSec}s + ${s.timeBankSec}s bank`} />
          <Row label="Straddle" value={s.straddle ? "Allowed (2× BB)" : "Off"} />
          <Row label="Spectators" value={s.allowSpectators ? "Allowed" : "Off"} />
        </dl>
      </section>
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Side games</h4>
        <ul className="mt-2 flex flex-col gap-3">
          {games.map((g) => (
            <li key={g.kind} className={cn("flex gap-3", !g.enabled && "opacity-50")}>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted [&>svg]:h-4 [&>svg]:w-4">
                {VOTE_ICON[g.kind]}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {labels[g.kind]}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-semibold leading-4",
                      !g.enabled ? "bg-surface-3 text-subtle" : g.active ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent",
                    )}
                  >
                    {!g.enabled ? "Off" : g.active ? (g.kind === "BOMB_POT" ? "Next hand" : "Running") : "Available"}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted">{sideGameExplainer(g.kind, s)}</p>
                {g.enabled && <p className="text-[11px] text-subtle">Vote: {g.rule}</p>}
              </div>
            </li>
          ))}
        </ul>
        {s.bombPot.enabled && s.bombPot.everyNHands > 0 && (
          <p className="mt-2 text-xs text-muted">
            Automatic bomb pot every {s.bombPot.everyNHands === 1 ? "hand" : `${s.bombPot.everyNHands} hands`}
            {view.sideGames.handsUntilAutoBombPot !== null && ` · next in ${view.sideGames.handsUntilAutoBombPot}`}.
          </p>
        )}
      </section>
      {view.hand && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Fair shuffle</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            Each deck is locked in with a fingerprint before the deal and revealed after the hand, so anyone can check it
            wasn&apos;t changed.
          </p>
          <p className="mt-2 text-[11px] text-subtle">Hand #{view.hand.handNumber} fingerprint</p>
          <code className="mt-0.5 block break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-muted">
            {view.hand.deckCommitment}
          </code>
          {view.hand.revealedDeck && (
            <>
              <p className="mt-2 text-[11px] text-subtle">Revealed deck</p>
              <code className="mt-0.5 block break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-muted">
                {view.hand.revealedDeck}
              </code>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Counts chat messages that arrived while the chat tab wasn't visible. */
export function useUnreadChat(chat: ChatMessage[], visible: boolean) {
  const seen = useRef(chat.length);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (visible) {
      seen.current = chat.length;
      setUnread(0);
    } else {
      setUnread(Math.max(0, chat.length - seen.current));
    }
  }, [chat.length, visible]);
  return unread;
}
