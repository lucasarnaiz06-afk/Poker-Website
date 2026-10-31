"use client";

import { LogOut, Moon, Settings, Sun, User } from "lucide-react";
import { signOutTo } from "@/components/auth/sign-out";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/ui/theme";
import type { ShellViewer } from "./viewer";

export function profileHref(viewer: ShellViewer) {
  return viewer.username ? `/u/${encodeURIComponent(viewer.username)}` : "/account";
}

export function UserMenu({ viewer }: { viewer: ShellViewer }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Account menu for ${viewer.name}`}
      >
        <Avatar name={viewer.name} avatar={viewer.avatar} image={viewer.image} seed={viewer.id} size="sm" decorative />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2.5">
          <Avatar
            name={viewer.name}
            avatar={viewer.avatar}
            image={viewer.image}
            seed={viewer.id}
            size="md"
            decorative
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{viewer.name}</span>
            <span className="block truncate text-xs text-muted">
              {viewer.username ? `@${viewer.username}` : viewer.email}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={profileHref(viewer)}>
            <User aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <Settings aria-hidden />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
          onSelect={(event) => {
            event.preventDefault();
            toggleTheme();
          }}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut aria-hidden />} onSelect={() => void signOutTo("/")}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
