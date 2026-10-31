"use client";

import { USERNAME_PATTERN, normalizeUsername } from "@poker-platform/shared/accounts/username";
import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Input } from "@/components/ui";
import { AvatarPicker } from "../account/_components/avatar-picker";
import type { AuthFormState } from "../auth/actions";
import { FormMessage, SubmitButton } from "../auth/_components/form-bits";
import { checkUsernameAction, onboardingAction } from "./actions";

export function OnboardingForm({
  callbackUrl,
  suggestedName,
  defaultAvatar,
}: {
  callbackUrl: string;
  suggestedName: string;
  defaultAvatar: string;
}) {
  const [state, action] = useFormState<AuthFormState, FormData>(onboardingAction, null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(suggestedName);
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const normalized = normalizeUsername(username);
  const formatOk = USERNAME_PATTERN.test(normalized);

  useEffect(() => {
    if (!formatOk) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    const timer = setTimeout(() => {
      checkUsernameAction(normalized)
        .then((available) => setAvailability(available ? "available" : "taken"))
        .catch(() => setAvailability("idle"));
    }, 350);

    return () => clearTimeout(timer);
  }, [normalized, formatOk]);

  const usernameHint =
    username && !formatOk
      ? "3-20 characters: letters, numbers and underscores."
      : availability === "available"
        ? `@${normalized} is available.`
        : availability === "checking"
          ? "Checking..."
          : "Your public handle. You can change it once every 30 days.";

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <Field
        label="Username"
        hint={usernameHint}
        error={state?.fieldErrors?.username ?? (availability === "taken" ? "That username is taken." : undefined)}
      >
        <Input
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          leading={<span className="text-sm">@</span>}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          required
          autoFocus
        />
      </Field>
      <Field label="Display name" optional hint="Shown on your profile. Defaults to your username." error={state?.fieldErrors?.displayName}>
        <Input name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} />
      </Field>
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-fg">Avatar</p>
        <AvatarPicker value={avatar} onChange={setAvatar} label={displayName || normalized || "?"} />
        {state?.fieldErrors?.avatar ? <p className="text-xs text-danger">{state.fieldErrors.avatar}</p> : null}
      </div>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <SubmitButton fullWidth disabled={!formatOk || availability === "taken"}>
        Start playing
      </SubmitButton>
      <p className="text-center text-xs text-subtle">You&apos;ll get 10,000 play-money chips. They have no cash value.</p>
    </form>
  );
}
