"use client";

import { useFormState } from "react-dom";
import { Field } from "@/components/ui";
import { resetPasswordAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";
import { PasswordInput } from "../_components/password-input";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useFormState<AuthFormState, FormData>(resetPasswordAction, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 10 characters." error={errors.password}>
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </Field>
      <Field label="Confirm new password" error={errors.confirmPassword}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <SubmitButton fullWidth>Update password</SubmitButton>
      <p className="text-xs text-subtle">This signs you out on every device.</p>
    </form>
  );
}
