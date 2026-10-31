"use client";

import { Link2 } from "lucide-react";
import { useFormState, useFormStatus } from "react-dom";
import { openInviteAction, type JoinTableState } from "@/app/lobby/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending}>
      Continue
    </Button>
  );
}

export function JoinCodeDialog() {
  const [state, formAction] = useFormState(openInviteAction, { error: null } satisfies JoinTableState);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" leftIcon={<Link2 aria-hidden />}>
          Join with code
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Join a private table"
        description="Paste the invite link or the 10-character code your host sent you."
        size="sm"
      >
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          <Field label="Invite link or code">
            <Input
              name="code"
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder="e.g. 7Gx2kQ9pLm"
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Submit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
