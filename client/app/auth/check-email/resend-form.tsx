"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { resendVerificationAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";

const COOLDOWN_S = 60;

/** "Resend email" with a visible cooldown (the server rate limits too). */
export function ResendForm() {
  const [state, action] = useFormState<AuthFormState, FormData>(resendVerificationAction, null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (state?.ok) setWait(COOLDOWN_S);
  }, [state]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="secondary" fullWidth disabled={wait > 0}>
        {wait > 0 ? `Resend email (${wait}s)` : "Resend email"}
      </SubmitButton>
    </form>
  );
}
