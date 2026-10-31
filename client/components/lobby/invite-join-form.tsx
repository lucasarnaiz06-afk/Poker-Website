"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { joinTableAction, type JoinTableState } from "@/app/lobby/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" fullWidth loading={pending} disabled={disabled}>
      Join table
    </Button>
  );
}

export function InviteJoinForm({
  tableId,
  inviteCode,
  hasPassword,
  isFull,
  canJoin,
}: {
  tableId: string;
  inviteCode: string;
  hasPassword: boolean;
  isFull: boolean;
  canJoin: boolean;
}) {
  const [state, formAction] = useFormState(joinTableAction, { error: null } satisfies JoinTableState);
  const blocked = isFull || !canJoin;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="lobbyId" value={tableId} />
      <input type="hidden" name="inviteCode" value={inviteCode} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {blocked ? (
        <Alert tone="info">{isFull ? "This table is full right now." : "This game is already running."}</Alert>
      ) : null}
      {hasPassword && !blocked ? (
        <Field label="Password" hint="Your host set a password for this table.">
          <Input name="password" type="password" required autoFocus autoComplete="off" maxLength={64} />
        </Field>
      ) : null}
      <Submit disabled={blocked} />
      <Button asChild variant="ghost" fullWidth>
        <Link href="/lobby">Back to lobby</Link>
      </Button>
    </form>
  );
}
