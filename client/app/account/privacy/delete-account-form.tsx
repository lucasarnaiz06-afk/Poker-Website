"use client";

import { useFormState } from "react-dom";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "../../auth/_components/form-bits";
import { PasswordInput } from "../../auth/_components/password-input";
import { deleteAccountAction, type AccountFormState } from "../actions";

export function DeleteAccountForm({ confirmWord, hasPassword }: { confirmWord: string; hasPassword: boolean }) {
  const [state, action] = useFormState<AccountFormState, FormData>(deleteAccountAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label={`Type ${confirmWord} to confirm`} error={state?.fieldErrors?.confirmation}>
        <Input name="confirmation" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </Field>
      {hasPassword ? (
        <Field label="Password" error={state?.fieldErrors?.password}>
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <FormMessage state={state?.fieldErrors ? null : state} />
      <div className="flex justify-end">
        <SubmitButton variant="danger">Delete my account</SubmitButton>
      </div>
    </form>
  );
}
