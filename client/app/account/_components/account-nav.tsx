"use client";

import { Gauge, KeyRound, Shield, SlidersHorizontal, User, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export const ACCOUNT_SECTIONS = [
  { href: "/account/profile", label: "Profile", icon: User },
  { href: "/account/security", label: "Security", icon: KeyRound },
  { href: "/account/preferences", label: "Preferences", icon: SlidersHorizontal },
  { href: "/account/wallet", label: "Wallet", icon: Wallet },
  { href: "/account/limits", label: "Limits", icon: Gauge },
  { href: "/account/privacy", label: "Privacy", icon: Shield },
] as const;

/** Vertical nav on desktop, horizontal scroller on phones. */
export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {ACCOUNT_SECTIONS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
