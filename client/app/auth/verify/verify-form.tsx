"use client";

import { useFormState } from "react-dom";
import { verifyEmailAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";

/** The token is consumed by a POST (button), so email scanners that prefetch the link can't use it. */
export function VerifyForm({ token }: { token: string }) {
  const [state, action] = useFormState<AuthFormState, FormData>(verifyEmailAction, null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton fullWidth>Verify and continue</SubmitButton>
    </form>
  );
}
