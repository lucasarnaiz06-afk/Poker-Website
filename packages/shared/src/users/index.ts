import { prisma } from "../db/prisma";
import { defaultAvatarId } from "../accounts/avatars";
import { normalizeUsername, USERNAME_PATTERN } from "../accounts/username";

/** Public, non-sensitive profile (no email, balance, or hole cards). */
export type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string | null;
  role: "USER" | "MOD" | "ADMIN";
  joinedAt: Date;
  lastSeenAt: Date | null;
  handsPlayed: number;
};

export async function getPublicProfileByUsername(rawUsername: string): Promise<PublicProfile | null> {
  const username = normalizeUsername(rawUsername);

  if (!USERNAME_PATTERN.test(username)) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      name: true,
      avatar: true,
      bio: true,
      role: true,
      status: true,
      createdAt: true,
      lastSeenAt: true,
      deletedAt: true,
      _count: { select: { handPlayers: true } },
    },
  });

  if (!user?.username || user.deletedAt || user.status === "BANNED") {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.name ?? user.username,
    avatar: user.avatar ?? defaultAvatarId(user.id),
    bio: user.bio,
    role: user.role,
    joinedAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
    handsPlayed: user._count.handPlayers,
  };
}

/** Minimal public identity for seat/chat rendering (never includes email). */
export type PublicIdentity = { id: string; username: string | null; displayName: string; avatar: string };

export async function getPublicIdentities(userIds: string[]): Promise<Map<string, PublicIdentity>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, username: true, displayName: true, name: true, avatar: true },
  });

  return new Map(
    users.map((user) => [
      user.id,
      {
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? user.username ?? user.name ?? "Player",
        avatar: user.avatar ?? defaultAvatarId(user.id),
      },
    ]),
  );
}
