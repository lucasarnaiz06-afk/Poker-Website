"use client";

import { LogOut, Menu } from "lucide-react";
import { signOutTo } from "@/components/auth/sign-out";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/dialog";
import { ChipBalancePill } from "./chip-balance";
import { Logo } from "./logo";
import { AUTH_ROUTES, isActivePath, NAV_ITEMS } from "./nav-items";
import { profileHref, UserMenu } from "./user-menu";
import type { ShellViewer } from "./viewer";

export function TopNav({ viewer }: { viewer: ShellViewer | null }) {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-md supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        {viewer ? (
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <IconButton aria-label="Open menu" className="-ml-2 md:hidden">
                <Menu aria-hidden />
              </IconButton>
            </SheetTrigger>
            <SheetContent side="left" title="Menu" hideTitle>
              <MobileNav viewer={viewer} pathname={pathname} />
            </SheetContent>
          </Sheet>
        ) : null}

        <Logo href={viewer ? "/lobby" : "/"} className="mr-4" />

        {viewer ? (
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {viewer ? (
            <>
              <ChipBalancePill balance={viewer.chipBalance} dailyBonus={viewer.dailyBonus} />
              <UserMenu viewer={viewer} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={AUTH_ROUTES.signIn}>Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={AUTH_ROUTES.signUp}>Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileNav({ viewer, pathname }: { viewer: ShellViewer; pathname: string }) {
  return (
    <div className="flex h-full flex-col">
      <Link
        href={profileHref(viewer)}
        className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar name={viewer.name} avatar={viewer.avatar} image={viewer.image} seed={viewer.id} size="md" decorative />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{viewer.name}</span>
          <span className="block truncate text-xs text-muted">
            {viewer.username ? `@${viewer.username}` : viewer.email}
          </span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-line pt-3">
        <button
          type="button"
          onClick={() => void signOutTo("/")}
          className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}
