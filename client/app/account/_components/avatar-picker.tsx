"use client";

import { AVATAR_IDS } from "@poker-platform/shared/accounts/avatars";
import { Check } from "lucide-react";
import { Avatar, cn } from "@/components/ui";

/** Grid of preset avatars. Renders a hidden input so it works inside plain <form action>. */
export function AvatarPicker({
  name = "avatar",
  value,
  onChange,
  label,
}: {
  name?: string;
  value: string;
  onChange: (id: string) => void;
  /** Text used for the initials preview. */
  label: string;
}) {
  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {AVATAR_IDS.map((id) => {
          const selected = id === value;

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Avatar ${id}`}
              onClick={() => onChange(id)}
              className={cn(
                "relative flex items-center justify-center rounded-full p-0.5 transition-shadow duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected ? "ring-2 ring-accent" : "ring-1 ring-transparent hover:ring-line",
              )}
            >
              <Avatar avatar={id} name={label} size="md" decorative />
              {selected ? (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <Check className="h-3 w-3" aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
