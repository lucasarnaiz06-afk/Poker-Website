"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState } from "react-dom";
import { Avatar, Field, Input, Textarea } from "@/components/ui";
import { formatDate } from "@/lib/format-time";
import { FormMessage, SubmitButton } from "../../auth/_components/form-bits";
import { AvatarPicker } from "../_components/avatar-picker";
import { changeUsernameAction, updateProfileAction, type AccountFormState } from "../actions";

export function ProfileForm({
  displayName: initialName,
  bio: initialBio,
  avatar: initialAvatar,
  username,
}: {
  displayName: string;
  bio: string;
  avatar: string;
  username: string;
}) {
  const [state, action] = useFormState<AccountFormState, FormData>(updateProfileAction, null);
  const [displayName, setDisplayName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);

  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="flex items-center gap-4">
        <Avatar avatar={avatar} name={displayName || username} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-fg">{displayName || username}</p>
          <Link href={`/u/${username}`} className="text-sm text-muted hover:text-fg">
            @{username} · View public profile
          </Link>
        </div>
      </div>
      <Field label="Display name" error={state?.fieldErrors?.displayName}>
        <Input name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} required />
      </Field>
      <Field label="Bio" optional hint="Up to 280 characters." error={state?.fieldErrors?.bio}>
        <Textarea name="bio" defaultValue={initialBio} maxLength={280} rows={3} />
      </Field>
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-fg">Avatar</p>
        <AvatarPicker value={avatar} onChange={setAvatar} label={displayName || username} />
      </div>
      <FormMessage state={state?.fieldErrors ? { error: state.error } : state} />
      <div className="flex justify-end">
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </form>
  );
}

export function UsernameForm({ username, nextChangeAt }: { username: string; nextChangeAt: string | null }) {
  const [state, action] = useFormState<AccountFormState, FormData>(changeUsernameAction, null);
  const locked = Boolean(nextChangeAt) && !state?.ok;

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Username"
        hint={
          locked && nextChangeAt
            ? `You can change it again on ${formatDate(nextChangeAt)}.`
            : "Letters, numbers and underscores. You can change it once every 30 days."
        }
        error={state?.fieldErrors?.username}
      >
        <Input
          name="username"
          defaultValue={username}
          leading={<span className="text-sm">@</span>}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          disabled={locked}
        />
      </Field>
      <FormMessage state={state?.fieldErrors ? null : state} />
      <div className="flex justify-end">
        <SubmitButton variant="secondary" disabled={locked}>
          Change username
        </SubmitButton>
      </div>
    </form>
  );
}
