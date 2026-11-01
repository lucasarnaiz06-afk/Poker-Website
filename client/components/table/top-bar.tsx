"use client";

import type { TableView } from "@poker-platform/shared/types";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Coffee,
  Link2,
  LogOut,
  MoreHorizontal,
  PanelRight,
  PlayCircle,
  PlusCircle,
  Settings,
  Volume2,
  VolumeX,
  WifiOff,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { useState } from "react";
import { Pill } from "./bits";
import { formatChips, variantShort } from "./format";
import type { ConnectionStatus, TableCommands } from "./table-controller";
import { GamesMenu } from "./votes";

export type TopBarProps = {
  view: TableView;
  status: ConnectionStatus;
  commands: TableCommands;
  lobbyHref: string;
  soundOn: boolean;
  onToggleSound: () => void;
  onOpenSettings: () => void;
  onRebuy: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  compact: boolean;
  /** Copies the invite link (private tables) or the table URL (public). */
  onCopyInvite: () => void;
};

export function TopBar({
  view,
  status,
  commands,
  lobbyHref,
  soundOn,
  onToggleSound,
  onOpenSettings,
  onRebuy,
  panelOpen,
  onTogglePanel,
  compact,
  onCopyInvite,
}: TopBarProps) {
  const s = view.settings;
  const me = view.seats.find((x) => x.seat === view.viewer.seat) ?? null;
  const router = useRouter();
  const [confirmStand, setConfirmStand] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const isHost = view.viewer.userId === view.hostUserId;
  const canClose = isHost && view.status !== "CLOSED";
  const inLiveHand = Boolean(me && view.hand && view.hand.phase !== "COMPLETE" && me.inHand && !me.folded);
  const isNit = Boolean(me?.isNit && view.sideGames.nitGame.active);

  const stand = async () => {
    setBusy(true);
    const res = await commands.stand();
    setBusy(false);
    if (res.ok) setConfirmStand(false);
  };

  const handLive = Boolean(view.hand && view.hand.phase !== "COMPLETE");

  const closeTable = async () => {
    setBusy(true);
    const res = await commands.close();
    setBusy(false);
    if (!res.ok) return;
    setConfirmClose(false);
    if (handLive) {
      toast({ title: "Closing after this hand", description: "Every stack goes back to its wallet once the hand ends.", tone: "default" });
      return;
    }
    toast({ title: "Table closed", description: "Every stack went back to its wallet.", tone: "success" });
    router.push(lobbyHref);
  };

  const flags: Array<{ label: string; tone: "warning" | "gold" | "info" }> = [];
  if (view.sideGames.bombPotQueued) flags.push({ label: "Bomb pot next", tone: "warning" });
  if (view.sideGames.nitGame.active) flags.push({ label: "Nit game", tone: "warning" });
  if (view.sideGames.bountyGame.active) flags.push({ label: "7-2 bounty", tone: "gold" });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-2 backdrop-blur sm:px-3">
      <Button asChild variant="ghost" size="sm" className="w-8 px-0 sm:w-auto sm:px-2.5">
        <Link href={lobbyHref} aria-label="Back to lobby">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Lobby</span>
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold">{view.name}</h1>
          {!compact && flags.map((f) => (
            <Pill key={f.label} tone={f.tone}>
              {f.label}
            </Pill>
          ))}
        </div>
        <p className="truncate text-xs text-muted tabular">
          {variantShort(s.variant)} · {formatChips(s.smallBlind)}/{formatChips(s.bigBlind)}
          {s.ante > 0 && ` · ante ${formatChips(s.ante)}`} · {s.maxPlayers}-max
          {compact && flags.length > 0 && <span className="text-warning"> · {flags.map((f) => f.label).join(" · ")}</span>}
        </p>
      </div>

      {status !== "connected" && (
        <span
          role="status"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium",
            status === "error" || status === "disconnected" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
          )}
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : "Offline"}</span>
        </span>
      )}

      <GamesMenu view={view} commands={commands} compact={compact} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {me ? (
            <Button variant="ghost" size="sm" aria-label="Seat options" className={cn(compact && "w-8 px-0")}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
              {!compact && "Seat"}
            </Button>
          ) : (
            <IconButton size="sm" aria-label="Table options">
              <MoreHorizontal />
            </IconButton>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent data-theme="dark">
          <DropdownMenuItem icon={<Link2 />} onSelect={onCopyInvite}>
            Copy invite link
          </DropdownMenuItem>
          {me && (
            <>
              <DropdownMenuSeparator />
              {me.status === "SITTING_OUT" ? (
                <DropdownMenuItem icon={<PlayCircle />} onSelect={() => void commands.sitOut(false)}>
                  I&apos;m back
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem icon={<Coffee />} onSelect={() => void commands.sitOut(true)}>
                  Sit out next hand
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon={<PlusCircle />} onSelect={onRebuy} disabled={me.stack >= s.maxBuyIn}>
                Add chips
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<LogOut />}
                tone="danger"
                onSelect={() => (inLiveHand || isNit ? setConfirmStand(true) : void commands.stand())}
              >
                Stand up
              </DropdownMenuItem>
            </>
          )}
          {canClose && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<XCircle />} tone="danger" onSelect={() => setConfirmClose(true)}>
                Close table
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <IconButton
        size="sm"
        aria-label={soundOn ? "Mute sounds" : "Turn sounds on"}
        aria-pressed={soundOn}
        onClick={onToggleSound}
        className={cn(compact && "hidden")}
      >
        {soundOn ? <Volume2 /> : <VolumeX />}
      </IconButton>
      <IconButton size="sm" aria-label="Table settings" onClick={onOpenSettings}>
        <Settings />
      </IconButton>
      <IconButton size="sm" aria-label={panelOpen ? "Hide side panel" : "Show chat, log and info"} aria-pressed={panelOpen} onClick={onTogglePanel}>
        <PanelRight />
      </IconButton>

      <Dialog open={confirmStand} onOpenChange={setConfirmStand}>
        <DialogContent
          data-theme="dark"
          className="text-fg"
          size="sm"
          title="Stand up?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmStand(false)}>
                Stay
              </Button>
              <Button variant="danger" onClick={() => void stand()} loading={busy}>
                Stand up
              </Button>
            </>
          }
        >
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {inLiveHand && <li>You&apos;ll fold your current hand.</li>}
            {isNit && (
              <li>
                You&apos;re still a nit, so leaving pays the {formatChips(s.nitGame.penaltyBB * s.bigBlind)} penalty to each
                player.
              </li>
            )}
            <li>Your chips go back to your wallet.</li>
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent
          data-theme="dark"
          className="text-fg"
          size="sm"
          title="Close this table?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClose(false)}>
                Keep playing
              </Button>
              <Button variant="danger" onClick={() => void closeTable()} loading={busy}>
                Close table
              </Button>
            </>
          }
        >
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            <li>The table closes for everyone.</li>
            {handLive && <li>The hand in progress is played out first.</li>}
            <li>Every player&apos;s chips go back to their wallet.</li>
          </ul>
        </DialogContent>
      </Dialog>
    </header>
  );
}
