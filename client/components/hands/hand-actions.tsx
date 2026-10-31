"use client";

import { handToPokerStars, verifyHandCommitment, type CommitmentCheck, type HandView } from "@poker-platform/shared/hands/client";
import { Check, Download, Link2, MoreHorizontal, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogContent, IconButton, InfoTip, toast } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HandActions({ view }: { view: HandView }) {
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<CommitmentCheck | null>(null);
  const [verifying, setVerifying] = useState(false);

  const copy = async () => {
    const url = `${window.location.origin}/hands/${view.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Link copied", description: "Signed-in players can open it. Hidden cards stay hidden.", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy", description: url, tone: "error" });
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      setCheck(await verifyHandCommitment(view));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" leftIcon={copied ? <Check /> : <Link2 />} onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" variant="secondary" aria-label="More hand options">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuItem
            icon={<Download />}
            onSelect={() => downloadText(`hand-${view.handNumber}-${view.id}.txt`, handToPokerStars(view) + "\n")}
          >
            Download (PokerStars format)
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ShieldCheck />}
            disabled={!view.deckProof || verifying}
            onSelect={() => void verify()}
            title={view.deckProof ? undefined : "Hands from before per-card shuffle proofs can't be verified"}
          >
            {verifying ? "Verifying…" : "Verify shuffle"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={check !== null} onOpenChange={(open) => (open ? null : setCheck(null))}>
        {check ? (
          <DialogContent
            title={check.ok ? "Shuffle verified" : "Verification failed"}
            description="Checked in your browser with SHA-256, without asking the server."
            size="lg"
          >
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                {check.ok ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden /> : <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />}
                <p className="text-fg">{check.reason}</p>
              </div>
              <dl className="space-y-3">
                <div>
                  <dt className="flex items-center gap-1 text-xs font-medium text-muted">
                    Published before the hand
                    <InfoTip label="About the commitment">
                      Before dealing, the server hashes every deck position with its own secret salt and publishes one fingerprint of
                      all of them. After the hand you get the salts for the cards you saw (your cards, the board, shown hands) and only
                      the hashes of the rest, so you can recompute the fingerprint and check your cards&apos; deal positions without
                      learning anyone&apos;s mucked cards or the burns.
                    </InfoTip>
                  </dt>
                  <dd className="break-all font-mono text-xs text-fg">{check.expected}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted">Computed from your proof</dt>
                  <dd className={`break-all font-mono text-xs ${check.computed === check.expected ? "text-accent" : "text-danger"}`}>{check.computed ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted">Your visible cards at their deal positions</dt>
                  <dd className={check.positionsOk ? "text-accent" : "text-danger"}>
                    {!check.verifiable
                      ? "Not verifiable"
                      : check.positionsOk
                        ? `Yes (${check.openedCount} of ${check.deckSize} positions opened, the rest stay hidden)`
                        : "No"}
                  </dd>
                </div>
              </dl>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
