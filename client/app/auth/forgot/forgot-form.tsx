"use client";

import { useFormState } from "react-dom";
import { Field, Input } from "@/components/ui";
import { forgotPasswordAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";

export function ForgotForm() {
  const [state, action] = useFormState<AuthFormState, FormData>(forgotPasswordAction, null);

  if (state?.ok) {
    return <FormMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Email" error={state?.fieldErrors?.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <SubmitButton fullWidth>Send reset link</SubmitButton>
    </form>
  );
}
