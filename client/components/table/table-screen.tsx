"use client";

import { inviteLinkPath } from "@poker-platform/shared/lobbies/client";
import type { ChatMessage, TableView } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { AlertCircle, RotateCw, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionDock } from "./action-bar";
import { BuyInDialog, SettingsDialog, type BuyInMode } from "./dialogs";
import { Felt } from "./felt";
import { ResultBanner } from "./felt-center";
import { useMediaQuery, useNow, useSessionHands, useTableSounds } from "./hooks";
import { usePreferences } from "./preferences";
import { SidePanel, useUnreadChat, type PanelTab } from "./side-panel";
import { unlockAudio } from "./sounds";
import { SessionSummaryDialog, useSeatSession } from "./session-summary";
import { useTableController } from "./table-context";
import type { ConnectionStatus, TableNotice } from "./table-controller";
import { TopBar } from "./top-bar";
import { VoteCard, VoteStack } from "./votes";

function firstOpenSeat(view: TableView): number | null {
  const taken = new Set(view.seats.map((s) => s.seat));
  for (let i = 1; i <= view.settings.maxPlayers; i += 1) if (!taken.has(i)) return i;
  return null;
}

let localNoticeSeq = 0;

/**
 * The full table experience. Render inside a <TableProvider> (live: <LiveTableProvider>,
 * fixtures: <MockTableProvider>). Always dark, whatever the site theme (`data-theme="dark"` on the
 * root and on every dialog / menu it portals out).
 */
export function TableScreen({
  lobbyHref = "/lobby",
  inviteCode = null,
  autoSit = false,
  className,
}: {
  lobbyHref?: string;
  /** "Play now" from the lobby: open the buy-in dialog for the first free seat once the table loads. */
  autoSit?: boolean;
  /** Private tables: the invite code, so "Copy invite link" shares the invite instead of the table URL. */
  inviteCode?: string | null;
  className?: string;
}) {
  const { view, status, error, stalled, retry, chat, now, commands, notices: serverNotices, dismissNotice: dismissServerNotice } =
    useTableController();
  const [localNotices, setLocalNotices] = useState<TableNotice[]>([]);
  const notices = localNotices.length ? [...serverNotices, ...localNotices] : serverNotices;
  const dismissNotice = useCallback(
    (id: string) => {
      setLocalNotices((list) => list.filter((n) => n.id !== id));
      dismissServerNotice(id);
    },
    [dismissServerNotice],
  );
  const pushLocal = useCallback((message: string, tone: TableNotice["tone"] = "info") => {
    localNoticeSeq += 1;
    setLocalNotices((list) => [...list.slice(-2), { id: `local-${localNoticeSeq}`, tone, message }]);
  }, []);
  const [prefs, updatePrefs] = usePreferences();
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const phone = !useMediaQuery("(min-width: 640px)", true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [buyIn, setBuyIn] = useState<BuyInMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resultInDock, setResultInDock] = useState(false);

  const seated = Boolean(view && view.viewer.seat !== null);
  const soundOn = prefs.sound ?? seated;
  useTableSounds(view, soundOn);
  const hands = useSessionHands(view);
  const panelVisible = wide ? panelOpen : sheetOpen;
  const unread = useUnreadChat(chat, panelVisible && tab === "chat");

  // The run-it-twice prompt for an eligible viewer lives in the action dock (it blocks the hand).
  const ritVote =
    view?.votes.find((v) => v.kind === "RUN_IT_TWICE" && v.status === "OPEN" && v.eligibleUserIds.includes(view.viewer.userId)) ??
    null;
  const ticking = Boolean(view && (view.hand?.actionDeadline || view.votes.length > 0 || view.nextHandAt));
  const nowMs = useNow(now, ticking);

  const bubbles = useChatBubbles(chat);
  const session = useSeatSession(view);

  const copyInvite = useCallback(async () => {
    if (!view) return;
    const url = `${window.location.origin}${inviteCode ? inviteLinkPath(inviteCode) : `/lobby/${encodeURIComponent(view.tableId)}`}`;
    try {
      await navigator.clipboard.writeText(url);
      pushLocal("Invite link copied");
    } catch {
      pushLocal(`Couldn't copy. The link is ${url}`, "error");
    }
  }, [view, inviteCode, pushLocal]);

  const onSit = useCallback((seat: number) => setBuyIn({ kind: "sit", seat }), []);
  const onRequestSeat = useCallback(() => {
    if (!view) return;
    const seat = firstOpenSeat(view);
    if (seat !== null) setBuyIn({ kind: "sit", seat });
  }, [view]);

  const autoSitDone = useRef(false);
  useEffect(() => {
    if (!autoSit || autoSitDone.current || !view || status !== "connected") return;
    autoSitDone.current = true;
    // Drop ?sit=1 so a reload doesn't reopen the dialog.
    const url = new URL(window.location.href);
    if (url.searchParams.has("sit")) {
      url.searchParams.delete("sit");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (view.viewer.seat === null) onRequestSeat();
  }, [autoSit, view, status, onRequestSeat]);

  if (!view) {
    return <TableSkeleton status={status} error={error} stalled={stalled} onRetry={retry} lobbyHref={lobbyHref} className={className} />;
  }

  const togglePanel = () => (wide ? setPanelOpen((v) => !v) : setSheetOpen((v) => !v));
  const panel = (
    <SidePanel view={view} chat={chat} hands={hands} commands={commands} tab={tab} onTabChange={setTab} unreadChat={unread} />
  );

  return (
    <div data-theme="dark" className={cn("flex h-dvh flex-col overflow-hidden bg-bg text-fg", className)}>
      <TopBar
        view={view}
        status={status}
        commands={commands}
        lobbyHref={lobbyHref}
        soundOn={soundOn}
        onToggleSound={() => {
          unlockAudio();
          updatePrefs({ sound: !soundOn });
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onRebuy={() => setBuyIn({ kind: "rebuy" })}
        panelOpen={panelVisible}
        onTogglePanel={togglePanel}
        compact={phone}
        onCopyInvite={() => void copyInvite()}
      />
      <ConnectionBanner status={status} error={error} stalled={stalled} onRetry={retry} lobbyHref={lobbyHref} />

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Table">
          {/* Open votes sit above the table (never over it) unless the side panel shows them. */}
          {!(wide && panelOpen) && (
            <VoteStack
              view={view}
              now={nowMs}
              commands={commands}
              exclude={ritVote?.id}
              inline={phone}
              className="mx-auto w-full max-w-xl shrink-0 px-2 pt-2 sm:px-4"
            />
          )}
          <div
            className="relative min-h-0 flex-1 px-1 pt-2 sm:px-4 sm:pt-3"
            style={{ background: "radial-gradient(ellipse at 50% 45%, rgb(var(--felt) / 0.10), transparent 65%)" }}
          >
            <Felt
              view={view}
              now={nowMs}
              inBB={prefs.showBB}
              onSit={onSit}
              bubbles={bubbles}
              onResultInDock={setResultInDock}
              starting={starting}
              onStart={async () => {
                setStarting(true);
                await commands.start();
                setStarting(false);
              }}
            />
            <Notices notices={notices} onDismiss={dismissNotice} />
            {unread > 0 && !panelVisible && (
              <button
                type="button"
                onClick={() => {
                  setTab("chat");
                  if (wide) setPanelOpen(true);
                  else setSheetOpen(true);
                }}
                className="absolute bottom-3 right-3 z-30 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg shadow-pop ring-1 ring-line hover:bg-surface-3"
              >
                {unread} new message{unread > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <ActionDock
            view={view}
            commands={commands}
            prefs={prefs}
            onRequestSeat={onRequestSeat}
            now={nowMs}
            prompt={ritVote ? <VoteCard vote={ritVote} view={view} now={nowMs} commands={commands} inline /> : null}
            result={resultInDock && view.hand?.result ? <ResultBanner view={view} inBB={prefs.showBB} compact maxHeight={phone ? 76 : 100} variant="dock" /> : null}
          />
        </main>

        {wide && panelOpen && (
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Chat, log and table info">
            <VoteStack view={view} now={nowMs} commands={commands} exclude={ritVote?.id} className="shrink-0 border-b border-line p-2" />
            {panel}
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent data-theme="dark" side="right" title="Table" hideTitle className="w-[min(380px,100vw)] text-fg [&>div:last-child]:overflow-hidden [&>div:last-child]:px-0 [&>div:last-child]:pb-0">
            <div className="flex h-full min-h-0 flex-col">{panel}</div>
          </SheetContent>
        </Sheet>
      )}

      {buyIn && (
        <BuyInDialog
          open={buyIn !== null}
          onOpenChange={(o) => !o && setBuyIn(null)}
          mode={buyIn}
          view={view}
          commands={commands}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} spectating={!seated} />
      <SessionSummaryDialog
        result={session.result}
        onClose={session.dismiss}
        handsHref={`/hands?table=${encodeURIComponent(view.tableId)}`}
        lobbyHref={lobbyHref}
      />
    </div>
  );
}

/** Latest message per player that arrived while watching; each fades after a few seconds. */
function useChatBubbles(chat: ChatMessage[]) {
  const [bubbles, setBubbles] = useState<Record<string, ChatMessage>>({});
  const seen = useRef(chat.length);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const fresh = chat.slice(seen.current);
    seen.current = chat.length;
    if (fresh.length === 0) return;
    setBubbles((b) => {
      const next = { ...b };
      for (const m of fresh) next[m.userId] = m;
      return next;
    });
    for (const m of fresh) {
      const t = window.setTimeout(() => {
        timers.current.delete(t);
        setBubbles((b) => {
          if (b[m.userId]?.id !== m.id) return b;
          const { [m.userId]: _gone, ...rest } = b;
          return rest;
        });
      }, 4000);
      timers.current.add(t);
    }
  }, [chat]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);
  return bubbles;
}

function Notices({ notices, onDismiss }: { notices: TableNotice[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((n) => window.setTimeout(() => onDismiss(n.id), 4500));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [notices, onDismiss]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-40 flex flex-col items-center gap-2 px-3" aria-live="assertive">
      {notices.map((n) => (
        <div
          key={n.id}
          role="alert"
          className={cn(
            "pointer-events-auto flex max-w-sm animate-rise-in items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-sm shadow-pop",
            n.tone === "error" ? "border-danger/40" : "border-line",
          )}
        >
          <AlertCircle className={cn("h-4 w-4 shrink-0", n.tone === "error" ? "text-danger" : "text-info")} aria-hidden />
          <span className="min-w-0 flex-1">{n.message}</span>
          <button type="button" onClick={() => onDismiss(n.id)} aria-label="Dismiss" className="rounded p-0.5 text-muted hover:text-fg">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Shown over the live table while the connection is down: never a dead end. */
function ConnectionBanner({
  status,
  error,
  stalled,
  onRetry,
  lobbyHref,
}: {
  status: ConnectionStatus;
  error: { code: string; message: string } | null;
  stalled: boolean;
  onRetry: () => void;
  lobbyHref: string;
}) {
  if (status === "connected" || (status === "connecting" && !stalled)) return null;
  const fatal = status === "error";
  const down = fatal || status === "disconnected" || stalled;
  const text = fatal
    ? (error?.message ?? "You've been disconnected from this table.")
    : status === "disconnected"
      ? "You're offline. Your seat is held for a while."
      : stalled
        ? "Still can't reach the table. Your seat is held for a while."
        : "Connection lost. Reconnecting…";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs sm:text-sm",
        down ? "border-danger/30 bg-danger/10 text-fg" : "border-warning/30 bg-warning/10 text-fg",
      )}
    >
      {down ? (
        <WifiOff className="h-4 w-4 shrink-0 text-danger" aria-hidden />
      ) : (
        <RotateCw className="h-4 w-4 shrink-0 animate-spin text-warning motion-reduce:animate-none" aria-hidden />
      )}
      <span className="min-w-0 flex-1">{text}</span>
      {down && (
        <>
          {!fatal || error?.code !== "TABLE_CLOSED" ? (
            <Button size="sm" variant="secondary" onClick={onRetry} leftIcon={<RotateCw />}>
              Retry
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            <Link href={lobbyHref}>Lobby</Link>
          </Button>
        </>
      )}
    </div>
  );
}

/** Headline for a join that failed, from the server's error code. */
function failureTitle(error: { code: string; message: string } | null): string {
  switch (error?.code) {
    case "TABLE_CLOSED":
      return "This table has closed";
    case "TABLE_NOT_FOUND":
      return "This table isn't available";
    case "PASSWORD_REQUIRED":
    case "INVITE_REQUIRED":
    case "FORBIDDEN":
      return "You need an invite";
    case "UNAUTHORIZED":
      return "Please sign in again";
    default:
      return "Can't connect to the table";
  }
}

function TableSkeleton({
  status,
  error,
  stalled,
  onRetry,
  lobbyHref,
  className,
}: {
  status: ConnectionStatus;
  error: { code: string; message: string } | null;
  stalled: boolean;
  onRetry: () => void;
  lobbyHref: string;
  className?: string;
}) {
  const pathname = usePathname();
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!retrying) return;
    const t = window.setTimeout(() => setRetrying(false), 1500);
    return () => window.clearTimeout(t);
  }, [retrying]);

  const failed = status === "error" || status === "disconnected" || stalled;
  if (failed) {
    const fatal = status === "error" && error;
    const title = fatal ? failureTitle(error) : "Can't connect to the table";
    const detail = fatal
      ? error.code === "TABLE_NOT_FOUND"
        ? "It may have closed, or it's private and needs an invite link from the host."
        : error.message
      : "The table server isn't responding. Check your connection; we'll keep trying in the background.";
    const signIn = fatal && error.code === "UNAUTHORIZED";
    const canRetry = !fatal || !["TABLE_CLOSED", "TABLE_NOT_FOUND"].includes(error.code);
    return (
      <div
        data-theme="dark"
        role="alert"
        className={cn("flex h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg", className)}
      >
        {fatal ? <AlertCircle className="h-8 w-8 text-danger" aria-hidden /> : <WifiOff className="h-8 w-8 text-warning" aria-hidden />}
        <div className="max-w-sm">
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{detail}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {signIn ? (
            <Button asChild>
              <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(pathname ?? lobbyHref)}`}>Sign in</Link>
            </Button>
          ) : canRetry ? (
            <Button
              onClick={() => {
                setRetrying(true);
                onRetry();
              }}
              loading={retrying}
              leftIcon={<RotateCw />}
            >
              Retry
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={lobbyHref}>Back to lobby</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div data-theme="dark" className={cn("flex h-dvh flex-col bg-bg", className)} aria-busy="true" aria-label="Loading table">
      <div className="flex h-14 items-center gap-3 border-b border-line px-3">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-2" />
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="aspect-[2/1] w-full max-w-4xl animate-pulse rounded-[50%] bg-surface" />
      </div>
      <div className="h-[120px] border-t border-line bg-surface" />
      <p className="sr-only" role="status">
        {status === "reconnecting" ? "Reconnecting to the table…" : "Connecting to the table…"}
      </p>
    </div>
  );
}
