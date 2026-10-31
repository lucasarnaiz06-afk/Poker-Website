import { getAccountView, type AccountView } from "@poker-platform/shared/accounts";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSessionTokenFromRequestCookies } from "./cookies";
import { authOptions } from "./options";

/** NextAuth session (database strategy). Cached per request. */
export const getCurrentSession = cache(async () => getServerSession(authOptions));

export async function requireCurrentSession(callbackUrl = "/lobby") {
  const session = await getCurrentSession();

  if (!session) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return session;
}

export type CurrentUser = {
  userId: string;
  account: AccountView;
  sessionToken: string | null;
};

/** Signed-in, active user or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getCurrentSession();

  if (!session?.user?.id) {
    return null;
  }

  const account = await getAccountView(session.user.id);

  if (!account || account.status !== "ACTIVE") {
    return null;
  }

  return { userId: session.user.id, account, sessionToken: getSessionTokenFromRequestCookies() };
});

/**
 * For pages and server actions that need a signed-in, onboarded user. Redirects to sign-in or onboarding.
 * Pass `allowWithoutUsername` on the onboarding page itself.
 */
export async function requireUser(
  options: { callbackUrl?: string; allowWithoutUsername?: boolean } = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const callbackUrl = options.callbackUrl ?? "/lobby";

  if (!user) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  if (!user.account.username && !options.allowWithoutUsername) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return user;
}

/** Only same-site relative paths are allowed as post-login redirects (prevents open redirects). */
export function safeCallbackUrl(value: unknown, fallback = "/lobby"): string {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }

  if (raw.startsWith("/auth/") || raw.startsWith("/api/")) {
    return fallback;
  }

  return raw.slice(0, 512);
}
