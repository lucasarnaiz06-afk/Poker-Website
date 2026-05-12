"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
      className="inline-flex h-10 items-center justify-center gap-2 border-2 border-[#f8f8f2] bg-[#111827] px-3 text-[10px] font-semibold text-[#f8f8f2] hover:bg-[#f8f8f2] hover:text-[#111827]"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      Sign out
    </button>
  );
}
