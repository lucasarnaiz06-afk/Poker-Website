"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input, type InputProps } from "@/components/ui";

/** Password input with a show/hide toggle. */
export function PasswordInput(props: Omit<InputProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
