"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Field, Input } from "@/components/ui";
import { twoFactorAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";

export function TwoFactorForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useFormState<AuthFormState, FormData>(twoFactorAction, null);
  const [useRecovery, setUseRecovery] = useState(false);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {useRecovery ? (
        <Field label="Recovery code" hint="Each recovery code works once.">
          <Input name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" required autoFocus />
        </Field>
      ) : (
        <Field label="Authentication code" hint="The 6-digit code from your authenticator app.">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,8}"
            maxLength={8}
            placeholder="123 456"
            required
            autoFocus
            className="tabular tracking-widest"
          />
        </Field>
      )}
      <FormMessage state={state} />
      <SubmitButton fullWidth>Verify</SubmitButton>
      <button
        type="button"
        onClick={() => setUseRecovery((value) => !value)}
        className="w-full text-center text-sm text-muted hover:text-fg"
      >
        {useRecovery ? "Use your authenticator app instead" : "Use a recovery code"}
      </button>
    </form>
  );
}
