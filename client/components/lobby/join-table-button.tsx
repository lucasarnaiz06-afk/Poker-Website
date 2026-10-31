"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { joinTableAction, type JoinTableState } from "@/app/lobby/actions";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonSize } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: JoinTableState = { error: null };

function SubmitJoin({
  children,
  size = "sm",
  fullWidth,
}: {
  children: React.ReactNode;
  size?: ButtonSize;
  fullWidth?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size={size} loading={pending} fullWidth={fullWidth}>
      {children}
    </Button>
  );
}

export type JoinTableButtonProps = {
  tableId: string;
  tableName: string;
  hasPassword: boolean;
  isFull: boolean;
  isMember: boolean;
  inviteCode?: string;
  size?: ButtonSize;
  fullWidth?: boolean;
};

/** Join (or reopen) a table. Password-protected tables ask for the password in a dialog. */
export function JoinTableButton({
  tableId,
  tableName,
  hasPassword,
  isFull,
  isMember,
  inviteCode,
  size = "sm",
  fullWidth,
}: JoinTableButtonProps) {
  const [state, formAction] = useFormState(joinTableAction, initialState);
  const [open, setOpen] = useState(false);

  if (isMember) {
    return (
      <Button asChild variant="secondary" size={size} fullWidth={fullWidth}>
        <Link href={`/lobby/${tableId}`}>Open</Link>
      </Button>
    );
  }

  if (isFull) {
    return (
      <Button variant="secondary" size={size} disabled fullWidth={fullWidth}>
        Full
      </Button>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="lobbyId" value={tableId} />
      {inviteCode ? <input type="hidden" name="inviteCode" value={inviteCode} /> : null}
    </>
  );

  if (!hasPassword) {
    return (
      <form action={formAction} className={fullWidth ? "w-full" : undefined}>
        {hidden}
        <SubmitJoin size={size} fullWidth={fullWidth}>
          <span>
            Join<span className="sr-only"> {tableName}</span>
          </span>
        </SubmitJoin>
        {state.error ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {state.error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} fullWidth={fullWidth} leftIcon={<Lock aria-hidden />}>
          Join<span className="sr-only"> {tableName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={`Join ${tableName}`} description="This table is password protected." size="sm">
        <form action={formAction} className="flex flex-col gap-4">
          {hidden}
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          <Field label="Password">
            <Input name="password" type="password" autoComplete="off" required autoFocus maxLength={64} />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <SubmitJoin size="md">Join table</SubmitJoin>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
