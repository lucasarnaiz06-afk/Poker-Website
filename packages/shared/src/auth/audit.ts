import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashIp } from "./crypto";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.login_blocked"
  | "auth.2fa_failed"
  | "auth.logout_all"
  | "auth.session_revoked"
  | "auth.email_verified"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.password_changed"
  | "auth.2fa_enabled"
  | "auth.2fa_disabled"
  | "auth.recovery_codes_regenerated"
  | "auth.recovery_code_used"
  | "auth.oauth_signin"
  | "auth.unverified_password_cleared"
  | "account.onboarded"
  | "account.username_changed"
  | "account.profile_updated"
  | "account.limits_updated"
  | "account.cool_off"
  | "account.self_excluded"
  | "account.data_exported"
  | "account.deleted"
  | "wallet.adjustment"
  | (string & {});

export type AuditInput = {
  userId?: string | null;
  action: AuditAction;
  ip?: string | null;
  meta?: Prisma.InputJsonValue;
};

/** Writes an audit row. Failures are logged and swallowed so auditing never blocks sign-in. */
export async function writeAuditLog(input: AuditInput, client: Pick<typeof prisma, "auditLog"> = prisma) {
  try {
    await client.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        ipHash: hashIp(input.ip),
        meta: input.meta ?? {},
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", input.action, error instanceof Error ? error.message : error);
  }
}
