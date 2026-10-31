import { prisma } from "@poker-platform/shared";
import { getDailyBonusStatus } from "@poker-platform/shared/wallet";
import type { Session } from "next-auth";
import type { ShellViewer } from "./viewer";

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Loads display fields for the shell. Reads profile/wallet columns defensively so the shell keeps
 * working while the accounts schema evolves; any failure falls back to session data.
 */
export async function getShellViewer(session: Session | null): Promise<ShellViewer | null> {
  if (!session?.user?.id) {
    return null;
  }

  const fallback: ShellViewer = {
    id: session.user.id,
    name: session.user.name ?? session.user.email?.split("@")[0] ?? "Player",
    email: session.user.email ?? null,
    username: null,
    avatar: null,
    image: session.user.image ?? null,
    chipBalance: null,
    dailyBonus: null,
  };

  try {
    const [user, daily] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id } }),
      getDailyBonusStatus(session.user.id).catch(() => null),
    ]);

    if (!user) {
      return fallback;
    }

    const record = user as unknown as Record<string, unknown>;
    const balance = record.chipBalance;

    return {
      ...fallback,
      name: readString(record, "displayName") ?? readString(record, "username") ?? fallback.name,
      username: readString(record, "username"),
      avatar: readString(record, "avatar"),
      image: readString(record, "image") ?? fallback.image,
      chipBalance: typeof balance === "number" && Number.isFinite(balance) ? balance : null,
      // Bonuses need an onboarded account (username chosen).
      dailyBonus:
        daily && !daily.claimedToday && readString(record, "username")
          ? { amount: daily.amount, streak: daily.streak }
          : null,
    };
  } catch {
    return fallback;
  }
}
