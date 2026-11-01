"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeTableAction } from "@/app/lobby/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

/** Host-only "Close" on a lobby card: confirms, then closes through the game server (stacks are refunded). */
export function CloseTableButton({ tableId, name }: { tableId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    startTransition(async () => {
      const result = await closeTableAction(tableId);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setOpen(false);
      toast({
        title: "Table closing",
        description: `${name} closes once any hand in progress ends. Every stack goes back to its wallet.`,
        tone: "success",
      });
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Close ${name}`}>
        Close
      </Button>
      <DialogContent
        size="sm"
        title="Close this table?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Keep it open
            </Button>
            <Button variant="danger" onClick={close} loading={pending}>
              Close table
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          <li>
            <span className="font-medium text-fg">{name}</span> closes for everyone.
          </li>
          <li>A hand in progress is played out first, then every player&apos;s chips go back to their wallet.</li>
          <li>This can&apos;t be undone.</li>
        </ul>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
