import { defaultAvatarId } from "@poker-platform/shared/accounts/avatars";
import { prisma } from "@poker-platform/shared/db";
import { SIGNUP_BONUS } from "@poker-platform/shared/wallet";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { AuthCard } from "../auth/_components/auth-card";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

/** One short step after a password sign-up is verified: pick an avatar, see the welcome chips, find a table. */
export default async function WelcomePage() {
  const user = await requireUser({ callbackUrl: "/welcome" });
  const bonus = await prisma.ledgerEntry.findUnique({ where: { refKey: `signup:${user.userId}` }, select: { delta: true } });
  const name = user.account.displayName ?? user.account.username ?? "there";

  return (
    <AuthCard title={`Welcome, ${name}`} description="One quick thing, then you're ready to play.">
      <WelcomeForm
        name={name}
        defaultAvatar={user.account.avatar ?? defaultAvatarId(user.userId)}
        bonus={bonus ? bonus.delta : null}
        signupBonus={SIGNUP_BONUS}
      />
    </AuthCard>
  );
}
