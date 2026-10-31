"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { AVATAR_IDS, avatarInitials, getAvatarPreset, isAvatarId } from "@poker-platform/shared/accounts/avatars";
import { cn } from "./cn";

/** Preset avatar ids users can pick (stored in User.avatar). Defined in packages/shared/src/accounts/avatars.ts. */
export const AVATAR_PRESET_IDS: readonly string[] = AVATAR_IDS;
export const isAvatarPresetId = isAvatarId;
export const getInitials = avatarInitials;

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizes: Record<AvatarSize, { box: string; text: string; icon: string }> = {
  xs: { box: "h-6 w-6", text: "text-[10px]", icon: "h-3 w-3" },
  sm: { box: "h-8 w-8", text: "text-xs", icon: "h-4 w-4" },
  md: { box: "h-10 w-10", text: "text-sm", icon: "h-5 w-5" },
  lg: { box: "h-14 w-14", text: "text-lg", icon: "h-7 w-7" },
  xl: { box: "h-20 w-20", text: "text-2xl", icon: "h-10 w-10" },
};

export type AvatarProps = {
  /** Display name, used for initials and alt text. */
  name?: string | null;
  /** Preset avatar id (e.g. "g07") or an image URL. */
  avatar?: string | null;
  /** Fallback image URL (e.g. OAuth profile image) when `avatar` is empty. */
  image?: string | null;
  /** Stable seed for the initials color (user id preferred; defaults to name). */
  seed?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Decorative avatars next to a visible name should be hidden from screen readers. */
  decorative?: boolean;
};

function isImageUrl(value: string) {
  return /^(https?:\/\/|\/)/.test(value);
}

export function Avatar({ name, avatar, image, seed, size = "md", className, decorative = false }: AvatarProps) {
  const s = sizes[size];
  const label = decorative ? undefined : (name ?? "User");
  const box = cn(
    "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
    s.box,
    className,
  );
  const src = avatar && isImageUrl(avatar) ? avatar : !avatar || !isAvatarId(avatar) ? (image ?? undefined) : undefined;
  // Preset id if given, otherwise a stable preset derived from the seed.
  const preset = getAvatarPreset(avatar && isAvatarId(avatar) ? avatar : null, seed ?? name ?? "");
  const fallback = (
    <span
      className={cn("flex h-full w-full items-center justify-center font-semibold", s.text)}
      style={{
        backgroundImage: `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`,
        color: preset.ink,
      }}
    >
      <span aria-hidden className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]">
        {avatarInitials(name)}
      </span>
    </span>
  );

  return (
    <AvatarPrimitive.Root
      className={box}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="h-full w-full object-cover" /> : null}
      <AvatarPrimitive.Fallback delayMs={src ? 400 : 0} asChild>
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
