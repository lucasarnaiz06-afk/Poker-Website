"use client";

import { useState, type FormEvent } from "react";
import { useFormState } from "react-dom";
import { Field, Input } from "@/components/ui";
import { registerAction, type AuthFormState } from "../actions";
import { FormMessage, SubmitButton } from "../_components/form-bits";
import { PasswordInput } from "../_components/password-input";

type FieldName = "email" | "username" | "password" | "confirmPassword";

/** Same rules as the server (which stays authoritative); shown inline as soon as a field is left. */
function validate(name: FieldName, values: Record<FieldName, string>): string | undefined {
  const value = values[name];

  switch (name) {
    case "email":
      if (!value.trim()) return "Enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter a valid email address.";
    case "username":
      if (!value.trim()) return "Choose a username.";
      return /^[A-Za-z0-9_]{3,20}$/.test(value.trim()) ? undefined : "Use 3-20 letters, numbers or underscores.";
    case "password":
      if (!value) return "Choose a password.";
      return value.length >= 10 ? undefined : "Use at least 10 characters.";
    case "confirmPassword":
      if (!value) return "Type your password again.";
      return value === values.password ? undefined : "Passwords don't match.";
  }
}

const FIELDS: FieldName[] = ["email", "username", "password", "confirmPassword"];

function readValues(form: HTMLFormElement): Record<FieldName, string> {
  const data = new FormData(form);
  return Object.fromEntries(FIELDS.map((name) => [name, String(data.get(name) ?? "")])) as Record<FieldName, string>;
}

export function RegisterForm() {
  const [state, action] = useFormState<AuthFormState, FormData>(registerAction, null);
  const [clientErrors, setClientErrors] = useState<Partial<Record<FieldName, string>>>({});
  // Server errors stay until the field is edited.
  const [edited, setEdited] = useState<Partial<Record<FieldName, boolean>>>({});
  const [lastState, setLastState] = useState(state);

  if (state !== lastState) {
    setLastState(state);
    setEdited({});
  }

  const serverErrors = (state?.fieldErrors ?? {}) as Partial<Record<FieldName, string>>;
  const errorFor = (name: FieldName) => clientErrors[name] ?? (edited[name] ? undefined : serverErrors[name]);

  function check(form: HTMLFormElement | null, name: FieldName) {
    if (!form) return;
    const values = readValues(form);
    setClientErrors((prev) => ({ ...prev, [name]: validate(name, values) }));
  }

  function onBlur(event: React.FocusEvent<HTMLInputElement>) {
    const name = event.target.name as FieldName;
    // Don't nag about a field nobody has typed in yet.
    if (event.target.value || clientErrors[name]) check(event.target.form, name);
  }

  function onInput(event: FormEvent<HTMLFormElement>) {
    const name = (event.target as HTMLInputElement).name as FieldName;
    if (!FIELDS.includes(name)) return;
    setEdited((prev) => ({ ...prev, [name]: true }));
    // Clear an error as soon as the field becomes valid.
    if (clientErrors[name]) check(event.currentTarget, name);
    if (name === "password" && clientErrors.confirmPassword) check(event.currentTarget, "confirmPassword");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const values = readValues(event.currentTarget);
    const errors = Object.fromEntries(FIELDS.map((name) => [name, validate(name, values)])) as Partial<Record<FieldName, string>>;
    setClientErrors(errors);
    const firstInvalid = FIELDS.find((name) => errors[name]);

    if (firstInvalid) {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} onInput={onInput} className="space-y-4" noValidate>
      <Field label="Email" error={errorFor("email")}>
        <Input name="email" type="email" autoComplete="email" required maxLength={254} onBlur={onBlur} />
      </Field>
      <Field label="Username" hint="3-20 characters: letters, numbers, underscores. Shown at the table." error={errorFor("username")}>
        <Input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_]{3,20}"
          onBlur={onBlur}
        />
      </Field>
      <Field label="Password" hint="At least 10 characters. A short phrase works well." error={errorFor("password")}>
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} maxLength={128} onBlur={onBlur} />
      </Field>
      <Field label="Confirm password" error={errorFor("confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required onBlur={onBlur} />
      </Field>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <SubmitButton fullWidth>Create account</SubmitButton>
      <p className="text-xs leading-5 text-subtle">
        Chips are play money only and have no cash value. You&apos;ll get 10,000 chips to start.
      </p>
    </form>
  );
}
