"use client";

import { useFormState } from "react-dom";
import { Field } from "@/components/ui";
import { FormMessage, SubmitButton } from "../../auth/_components/form-bits";
import { PasswordInput } from "../../auth/_components/password-input";
import { changePasswordAction, type AccountFormState } from "../actions";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action] = useFormState<AccountFormState, FormData>(changePasswordAction, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {hasPassword ? (
        <Field label="Current password" error={errors.currentPassword}>
          <PasswordInput name="currentPassword" autoComplete="current-password" required />
        </Field>
      ) : null}
      <Field label="New password" hint="At least 10 characters. Not a common password." error={errors.newPassword}>
        <PasswordInput name="newPassword" autoComplete="new-password" minLength={10} maxLength={128} required />
      </Field>
      <Field label="Confirm new password" error={errors.confirmPassword}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <div className="flex justify-end">
        <SubmitButton variant="secondary">{hasPassword ? "Change password" : "Set password"}</SubmitButton>
      </div>
    </form>
  );
}
