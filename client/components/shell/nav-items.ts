import { BarChart3, History, LayoutGrid, Trophy, Wrench, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/lobby", label: "Lobby", icon: LayoutGrid },
  { href: "/hands", label: "Hands", icon: History },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/tools", label: "Tools", icon: Wrench },
];

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Routes rendered without the app shell (full-screen table views). /lobby/join/* keeps the shell.
 */
export function isFullScreenRoute(pathname: string) {
  if (/^\/lobby\/(?!join(?:\/|$))[^/]+/.test(pathname)) {
    return true;
  }

  return /^\/(table|play)(\/|$)/.test(pathname) || /^\/dev\/table(\/|$)/.test(pathname);
}

/** Auth routes owned by the accounts area. */
export const AUTH_ROUTES = { signIn: "/auth/signin", signUp: "/auth/signup" } as const;
