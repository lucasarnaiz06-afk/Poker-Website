import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma";
import { getSessionTokensFromCookieHeader, SESSION_MAX_AGE_SECONDS } from "./cookies";
import { hashIp } from "./crypto";

export type AuthenticatedUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  /** Public handle (lowercase). Null until onboarding is complete. */
  username?: string | null;
  displayName?: string | null;
  /** Preset avatar id. */
  avatar?: string | null;
  role?: "USER" | "MOD" | "ADMIN";
};

export type AuthenticatedSession = {
  sessionToken: string;
  expires: Date;
  user: AuthenticatedUser;
};

/**
 * Resolves a NextAuth database session token. Returns null for expired sessions and for users that are
 * deleted, suspended or banned (so the game server rejects them too).
 */
export async function getAuthenticatedSessionFromToken(
  sessionToken?: string | null,
): Promise<AuthenticatedSession | null> {
  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!session || session.expires <= new Date()) {
    return null;
  }

  if (session.user.deletedAt || session.user.status !== "ACTIVE") {
    return null;
  }

  return {
    sessionToken: session.sessionToken,
    expires: session.expires,
    user: {
      id: session.user.id,
      name: session.user.displayName ?? session.user.name,
      email: session.user.email,
      image: session.user.image,
      username: session.user.username,
      displayName: session.user.displayName,
      avatar: session.user.avatar,
      role: session.user.role,
    },
  };
}

export async function getAuthenticatedSessionFromCookieHeader(
  cookieHeader?: string | null,
): Promise<AuthenticatedSession | null> {
  for (const sessionToken of getSessionTokensFromCookieHeader(cookieHeader)) {
    const session = await getAuthenticatedSessionFromToken(sessionToken);

    if (session) {
      return session;
    }
  }

  return null;
}

/**
 * Creates a database session row exactly like NextAuth's database strategy does, for logins that don't
 * go through NextAuth (password, email verification). The caller sets the NextAuth session cookie.
 */
export async function createDatabaseSession(input: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ sessionToken: string; expires: Date }> {
  const now = input.now ?? new Date();
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: {
      sessionToken,
      userId: input.userId,
      expires,
      ipHash: hashIp(input.ip),
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
  });

  return { sessionToken, expires };
}

export async function deleteSessionByToken(sessionToken: string) {
  await prisma.session.deleteMany({ where: { sessionToken } });
}

/** Updates lastSeenAt at most once every 5 minutes per user. */
export async function touchUserLastSeen(userId: string, now = new Date()) {
  const threshold = new Date(now.getTime() - 5 * 60_000);
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }] },
    data: { lastSeenAt: now },
  });
}
