"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import { Chips } from "@/components/ui";
import { AvatarPicker } from "../account/_components/avatar-picker";
import type { AuthFormState } from "../auth/actions";
import { FormMessage, SubmitButton } from "../auth/_components/form-bits";
import { welcomeAction } from "./actions";

export function WelcomeForm({
  name,
  defaultAvatar,
  bonus,
  signupBonus,
}: {
  name: string;
  defaultAvatar: string;
  /** Welcome chips already granted (null while not yet granted). */
  bonus: number | null;
  signupBonus: number;
}) {
  const [state, action] = useFormState<AuthFormState, FormData>(welcomeAction, null);
  const [avatar, setAvatar] = useState(defaultAvatar);

  return (
    <form action={action} className="space-y-6">
      <div>
        <p className="mb-3 text-sm font-medium text-fg">Pick your avatar</p>
        <AvatarPicker value={avatar} onChange={setAvatar} label={name} />
        <p className="mt-2 text-xs text-subtle">Shown next to your name at the table. You can change it later.</p>
      </div>

      <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
        {bonus !== null ? (
          <>
            <p className="text-sm font-medium text-fg">
              Here are your <Chips amount={bonus} icon className="text-gold" /> chips
            </p>
            <p className="mt-0.5 text-xs text-muted">Play money for any table. Come back daily for a bonus.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-fg">
              Your <Chips amount={signupBonus} icon className="text-gold" /> welcome chips are on the way
            </p>
            <p className="mt-0.5 text-xs text-muted">They land in your wallet as soon as your account is fully set up.</p>
          </>
        )}
      </div>

      <FormMessage state={state} />
      <SubmitButton fullWidth>Find a table</SubmitButton>
    </form>
  );
}
