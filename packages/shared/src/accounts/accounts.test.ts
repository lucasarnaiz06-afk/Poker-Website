import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import {
  checkPasswordStrength,
  checkRateLimit,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  generateTotpCode,
  hashUserPassword,
  rateLimitKey,
  recordRateLimitAttempt,
  signValue,
  verifySignedValue,
  verifyUserPassword,
} from "../auth";
import { getAuthenticatedSessionFromToken } from "../auth/session";
import { getBalance, grantSignupBonus } from "../wallet";
import {
  assertCanPlay,
  beginTotpSetup,
  changeUsername,
  checkCanPlay,
  completeOnboarding,
  completeTwoFactorLogin,
  confirmTotpSetup,
  deleteAccount,
  loginWithPassword,
  mergePreferences,
  normalizeEmailForLimits,
  parsePreferences,
  PlayRestrictedError,
  registerWithPassword,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  selfExclude,
  startCoolOff,
  updateResponsibleGamingLimits,
  usernameSchema,
  resendVerificationForEmail,
  verifyEmailToken,
} from "./index";

const ctx = { ip: "203.0.113.7", userAgent: "vitest" };
const STRONG = "correct horse battery staple";

/** Captures links printed by the console mailer. */
function captureMail() {
  const messages: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  });

  return {
    lastLink(path: string) {
      const text = messages.join("\n");
      const matches = [...text.matchAll(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`, "g"))];
      const last = matches[matches.length - 1];
      return last ? decodeURIComponent(last[1]!) : null;
    },
    restore: () => spy.mockRestore(),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("crypto helpers", () => {
  it("round-trips AES-GCM secrets and detects tampering", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");

    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("signs values with expiry", () => {
    const token = signValue("hello", 1_000, 0);
    expect(verifySignedValue(token, 500)).toBe("hello");
    expect(verifySignedValue(token, 1_500)).toBeNull();
    expect(verifySignedValue(token.replace("hello", "hellp"), 500)).toBeNull();
  });

  it("compares in constant time", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashUserPassword(STRONG);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyUserPassword(STRONG, hash)).toBe(true);
    expect(await verifyUserPassword("wrong password!!", hash)).toBe(false);
    expect(await verifyUserPassword(STRONG, null)).toBe(false);
  });

  it("enforces strength rules", () => {
    expect(checkPasswordStrength("short").ok).toBe(false);
    expect(checkPasswordStrength("password123").ok).toBe(false);
    expect(checkPasswordStrength("Password2024!").ok).toBe(false);
    expect(checkPasswordStrength("1234567890").ok).toBe(false);
    expect(checkPasswordStrength("aaaaaaaaaaaa").ok).toBe(false);
    expect(checkPasswordStrength("lucky_river_9xq", { username: "lucky_river" }).ok).toBe(false);
    expect(checkPasswordStrength(STRONG).ok).toBe(true);
  });
});

describe("rate limiting", () => {
  it("locks with exponential backoff after the free attempts", async () => {
    const key = rateLimitKey("loginAccount", "acct", "someone@example.com");
    const policy = { windowMs: 60_000, freeAttempts: 2, baseLockMs: 1_000, maxLockMs: 10_000 };
    const now = new Date("2026-01-01T00:00:00Z");

    expect((await recordRateLimitAttempt(key, policy, now)).lockedUntil).toBeNull();
    expect((await recordRateLimitAttempt(key, policy, now)).lockedUntil).toBeNull();
    const third = await recordRateLimitAttempt(key, policy, now);
    expect(third.lockedUntil?.getTime()).toBe(now.getTime() + 1_000);
    const fourth = await recordRateLimitAttempt(key, policy, now);
    expect(fourth.lockedUntil?.getTime()).toBe(now.getTime() + 2_000);

    expect((await checkRateLimit(key, now)).allowed).toBe(false);
    expect((await checkRateLimit(key, new Date(now.getTime() + 2_001))).allowed).toBe(true);
  });
});

describe("username + preferences", () => {
  it("normalizes and validates usernames", () => {
    expect(usernameSchema.parse("  Lucky_River ")).toBe("lucky_river");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("has space").success).toBe(false);
    expect(usernameSchema.safeParse("admin").success).toBe(false);
    expect(usernameSchema.safeParse("deleted_abc").success).toBe(false);
  });

  it("parses preferences leniently and merges strictly", () => {
    const parsed = parsePreferences({ deckStyle: "four-color", sounds: "loud", extra: 1 });
    expect(parsed.deckStyle).toBe("four-color");
    expect(parsed.sounds).toBe(true);
    expect("extra" in parsed).toBe(false);
    expect(mergePreferences(parsed, { theme: "light" }).theme).toBe("light");
  });
});

describe("registration, verification and login", () => {
  it("registers, verifies by email link, grants the signup bonus, and logs in", async () => {
    const mail = captureMail();

    try {
      const registered = await registerWithPassword({ email: "New@Example.com", username: "NewPlayer", password: STRONG }, ctx);
      expect(registered.ok).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@example.com" } });
      expect(user.username).toBe("newplayer");
      expect(user.emailVerified).toBeNull();

      // Unverified accounts can't log in yet.
      const early = await loginWithPassword({ identifier: "newplayer", password: STRONG }, ctx);
      expect(early).toMatchObject({ ok: false, code: "EMAIL_NOT_VERIFIED" });

      const token = mail.lastLink("/auth/verify");
      expect(token).toBeTruthy();
      const verified = await verifyEmailToken(token!, ctx);
      expect(verified.ok).toBe(true);
      expect(await getBalance(user.id)).toBe(10_000);

      // Single use.
      expect((await verifyEmailToken(token!, ctx)).ok).toBe(false);

      if (verified.ok) {
        const session = await getAuthenticatedSessionFromToken(verified.sessionToken);
        expect(session?.user.id).toBe(user.id);
        expect(session?.user.username).toBe("newplayer");
      }

      const byEmail = await loginWithPassword({ identifier: "NEW@example.com", password: STRONG }, ctx);
      expect(byEmail).toMatchObject({ ok: true, twoFactorRequired: false });
    } finally {
      mail.restore();
    }
  });

  it("does not reveal whether an email is registered", async () => {
    const mail = captureMail();

    try {
      await createTestUser({ email: "taken@example.com" });
      const result = await registerWithPassword({ email: "taken@example.com", username: "someoneelse", password: STRONG }, ctx);
      expect(result).toEqual({ ok: true });
      expect(await prisma.user.count({ where: { username: "someoneelse" } })).toBe(0);

      const unknownReset = await requestPasswordReset({ email: "nobody@example.com" }, ctx);
      expect(unknownReset).toEqual({ ok: true });
    } finally {
      mail.restore();
    }
  });

  it("resends verification by address (rate limited, no enumeration) and uses the request origin in dev", async () => {
    const mail = captureMail();

    try {
      await registerWithPassword({ email: "again@example.com", username: "againplayer", password: STRONG }, ctx);
      const first = mail.lastLink("/auth/verify");
      const devCtx = { ...ctx, appOrigin: "http://192.168.1.9:3000" };
      expect(await resendVerificationForEmail("again@example.com", devCtx)).toEqual({ ok: true });
      const second = mail.lastLink("http://192.168.1.9:3000/auth/verify");
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
      // Unknown and verified addresses get the same answer.
      expect(await resendVerificationForEmail("nobody@example.com", ctx)).toEqual({ ok: true });
      expect((await resendVerificationForEmail("not-an-email", ctx)).ok).toBe(false);
      for (let i = 0; i < 6; i += 1) await resendVerificationForEmail("again@example.com", ctx);
      expect(await resendVerificationForEmail("again@example.com", ctx)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      expect((await verifyEmailToken(second!, ctx)).ok).toBe(true);
    } finally {
      mail.restore();
    }
  });

  it("limits sign-ups per normalized email regardless of IP", async () => {
    const mail = captureMail();

    try {
      expect(normalizeEmailForLimits(" Farm+1@Example.com ")).toBe("farm@example.com");
      for (let i = 0; i < 3; i += 1) {
        const result = await registerWithPassword(
          { email: `farm+${i}@example.com`, username: `farmer_${i}`, password: STRONG },
          { ip: `198.51.100.${i}`, userAgent: "vitest" },
        );
        expect(result.ok).toBe(true);
      }
      const blocked = await registerWithPassword(
        { email: "FARM+9@example.com", username: "farmer_9", password: STRONG },
        { ip: "198.51.100.99", userAgent: "vitest" },
      );
      expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    } finally {
      mail.restore();
    }
  });

  it("enforces a configurable site-wide registration ceiling, even without a client IP", async () => {
    const mail = captureMail();
    const previous = process.env.REGISTRATION_RATE_LIMIT_PER_MINUTE;
    process.env.REGISTRATION_RATE_LIMIT_PER_MINUTE = "3";

    try {
      for (let i = 0; i < 3; i += 1) {
        const result = await registerWithPassword(
          { email: `bulk${i}@example${i}.org`, username: `bulk_${i}`, password: STRONG },
          { ip: null, userAgent: "vitest" },
        );
        expect(result.ok).toBe(true);
      }
      const blocked = await registerWithPassword(
        { email: "bulk9@example9.org", username: "bulk_9", password: STRONG },
        { ip: "203.0.113.200", userAgent: "vitest" },
      );
      expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    } finally {
      if (previous === undefined) delete process.env.REGISTRATION_RATE_LIMIT_PER_MINUTE;
      else process.env.REGISTRATION_RATE_LIMIT_PER_MINUTE = previous;
      mail.restore();
    }
  });

  it("only grants the signup bonus to verified (or OAuth) accounts, exactly once", async () => {
    // Unverified password account: no bonus from onboarding or a direct grant.
    const unverified = await createTestUser({ username: null });
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerified: null, passwordHash: "x" } });
    expect((await completeOnboarding(unverified.id, { username: "not_yet", avatar: "g01" }, ctx)).ok).toBe(true);
    expect(await grantSignupBonus(unverified.id)).toBeNull();
    expect(await getBalance(unverified.id)).toBe(0);

    // Verifying later pays it once.
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerified: new Date() } });
    await grantSignupBonus(unverified.id);
    await grantSignupBonus(unverified.id);
    expect(await getBalance(unverified.id)).toBe(10_000);

    // Google accounts (no emailVerified column set by NextAuth) qualify at onboarding.
    const google = await createTestUser({ username: null });
    await prisma.user.update({ where: { id: google.id }, data: { emailVerified: null } });
    await prisma.account.create({
      data: { userId: google.id, type: "oauth", provider: "google", providerAccountId: `g-${google.id}` },
    });
    expect((await completeOnboarding(google.id, { username: "google_user", avatar: "g02" }, ctx)).ok).toBe(true);
    expect(await getBalance(google.id)).toBe(10_000);
  });

  it("verifying an email before onboarding defers the bonus to onboarding", async () => {
    const mail = captureMail();

    try {
      const user = await createTestUser({ username: null });
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: null } });
      await resendEmailVerification(user.id, ctx);
      const token = mail.lastLink("/auth/verify");
      expect((await verifyEmailToken(token!, ctx)).ok).toBe(true);
      expect(await getBalance(user.id)).toBe(0);

      expect((await completeOnboarding(user.id, { username: "late_onboard", avatar: "g01" }, ctx)).ok).toBe(true);
      expect((await completeOnboarding(user.id, { username: "late_onboard", avatar: "g03" }, ctx)).ok).toBe(true);
      expect(await getBalance(user.id)).toBe(10_000);
    } finally {
      mail.restore();
    }
  });

  it("returns the same error for unknown users and wrong passwords, then rate limits", async () => {
    const user = await createTestUser({ email: "rl@example.com" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashUserPassword(STRONG) } });

    const unknown = await loginWithPassword({ identifier: "ghost@example.com", password: STRONG }, ctx);
    const wrong = await loginWithPassword({ identifier: "rl@example.com", password: "not the password" }, ctx);
    expect(unknown.ok || wrong.ok).toBe(false);
    if (!unknown.ok && !wrong.ok) {
      expect(unknown.error).toBe(wrong.error);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await loginWithPassword({ identifier: "rl@example.com", password: "not the password" }, ctx);
    }

    const locked = await loginWithPassword({ identifier: "rl@example.com", password: STRONG }, ctx);
    expect(locked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("resets a password with a single-use token and signs out other sessions", async () => {
    const mail = captureMail();

    try {
      const user = await createTestUser({ email: "reset@example.com" });
      await prisma.session.create({ data: { sessionToken: "old-session", userId: user.id, expires: new Date(Date.now() + 60_000) } });

      await requestPasswordReset({ email: "reset@example.com" }, ctx);
      const token = mail.lastLink("/auth/reset");
      expect(token).toBeTruthy();

      expect((await resetPassword({ token: token!, password: "short" }, ctx)).ok).toBe(false);
      expect((await resetPassword({ token: token!, password: STRONG }, ctx)).ok).toBe(true);
      expect((await resetPassword({ token: token!, password: STRONG }, ctx)).ok).toBe(false);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

      const login = await loginWithPassword({ identifier: "reset@example.com", password: STRONG }, ctx);
      expect(login.ok).toBe(true);
    } finally {
      mail.restore();
    }
  });
});

describe("two-factor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires a TOTP code at password login once enabled, and rejects replays", async () => {
    // TOTP codes depend on the 30 s time step. With the real clock, a step boundary between generating a code
    // and verifying it (or between setup and login) made this test flaky, so only Date is faked and pinned
    // 10 s into a step; time then moves only where the test says so.
    const STEP_MS = 30_000;
    const t0 = Math.floor(Date.now() / STEP_MS) * STEP_MS + 10_000;
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });

    const user = await createTestUser({ email: "totp@example.com" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashUserPassword(STRONG) } });

    const setup = await beginTotpSetup(user.id);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecret).not.toContain(setup.secret);

    // Confirm setup with the current step's code; login then happens one step later.
    const confirm = await confirmTotpSetup(user.id, generateTotpCode(setup.secret, t0), ctx);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(confirm.recoveryCodes).toHaveLength(10);

    const step1 = await loginWithPassword({ identifier: "totp@example.com", password: STRONG }, ctx);
    expect(step1).toMatchObject({ ok: true, twoFactorRequired: true });
    if (!step1.ok || !step1.twoFactorRequired) return;

    vi.setSystemTime(t0 + STEP_MS);
    const code = generateTotpCode(setup.secret, t0 + STEP_MS);
    // A wrong code: not valid in any step inside the +/-1 window.
    const valid = new Set([-1, 0, 1].map((k) => generateTotpCode(setup.secret, t0 + STEP_MS + k * STEP_MS)));
    let wrong = "000000";
    while (valid.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, "0");
    expect((await completeTwoFactorLogin(step1.pendingToken, wrong, ctx)).ok).toBe(false);
    // The setup code (an earlier step) can't be replayed for login.
    expect((await completeTwoFactorLogin(step1.pendingToken, generateTotpCode(setup.secret, t0), ctx)).ok).toBe(false);
    expect((await completeTwoFactorLogin(step1.pendingToken, code, ctx)).ok).toBe(true);
    // Same code can't be used twice.
    expect((await completeTwoFactorLogin(step1.pendingToken, code, ctx)).ok).toBe(false);

    // Recovery codes work once.
    const recovery = confirm.recoveryCodes[0]!;
    expect((await completeTwoFactorLogin(step1.pendingToken, recovery.toUpperCase(), ctx)).ok).toBe(true);
    expect((await completeTwoFactorLogin(step1.pendingToken, recovery, ctx)).ok).toBe(false);

    expect((await completeTwoFactorLogin("forged.token.value", code, ctx)).ok).toBe(false);
  });
});

describe("onboarding + profile", () => {
  it("sets the username once, grants the bonus idempotently, and enforces the change cooldown", async () => {
    const user = await createTestUser({ username: null });

    expect((await completeOnboarding(user.id, { username: "Ace_High", avatar: "g01" }, ctx)).ok).toBe(true);
    expect((await completeOnboarding(user.id, { username: "ace_high", avatar: "g02" }, ctx)).ok).toBe(true);
    expect((await completeOnboarding(user.id, { username: "other", avatar: "g02" }, ctx)).ok).toBe(false);
    expect(await getBalance(user.id)).toBe(10_000);

    const other = await createTestUser({ username: null });
    expect(await completeOnboarding(other.id, { username: "ace_high", avatar: "g01" }, ctx)).toMatchObject({
      ok: false,
      code: "USERNAME_TAKEN",
    });
    expect((await completeOnboarding(other.id, { username: "x", avatar: "g01" }, ctx)).ok).toBe(false);
    expect((await completeOnboarding(other.id, { username: "valid_name", avatar: "nope" }, ctx)).ok).toBe(false);

    const now = new Date("2026-06-01T00:00:00Z");
    expect((await changeUsername(user.id, { username: "ace_low" }, ctx, now)).ok).toBe(true);
    expect(await changeUsername(user.id, { username: "ace_mid" }, ctx, new Date("2026-06-20T00:00:00Z"))).toMatchObject({
      ok: false,
      code: "COOLDOWN",
    });
    expect((await changeUsername(user.id, { username: "ace_mid" }, ctx, new Date("2026-07-02T00:00:00Z"))).ok).toBe(true);
  });
});

describe("responsible gaming / assertCanPlay", () => {
  it("allows normal accounts and blocks cool-off, self-exclusion and bans", async () => {
    const user = await createTestUser();
    await expect(assertCanPlay(user.id)).resolves.toBeUndefined();

    const now = new Date();
    await startCoolOff(user.id, "24h", ctx, now);
    await expect(assertCanPlay(user.id, now)).rejects.toMatchObject({ code: "COOL_OFF" });
    expect((await checkCanPlay(user.id, new Date(now.getTime() + 25 * 3_600_000))).ok).toBe(true);

    const excluded = await createTestUser();
    await selfExclude(excluded.id, "permanent", ctx);
    await expect(assertCanPlay(excluded.id)).rejects.toBeInstanceOf(PlayRestrictedError);

    const banned = await createTestUser();
    await prisma.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    await expect(assertCanPlay(banned.id)).rejects.toMatchObject({ code: "ACCOUNT_BANNED" });

    const fresh = await createTestUser({ username: null });
    await expect(assertCanPlay(fresh.id)).rejects.toMatchObject({ code: "ONBOARDING_REQUIRED" });
  });

  it("enforces the daily loss limit from today's hands; loosening is delayed 24h", async () => {
    const user = await createTestUser();
    const creator = await createTestUser();
    const lobby = await prisma.lobby.create({
      data: { name: "t", smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 200, createdByUserId: creator.id },
    });
    const now = new Date();

    await updateResponsibleGamingLimits(user.id, { dailyLossLimit: 500 }, ctx, now);
    const hand = await prisma.hand.create({
      data: {
        lobbyId: lobby.id,
        handNumber: 1,
        smallBlind: 1,
        bigBlind: 2,
        buttonSeat: 1,
        boards: [],
        pots: [],
        events: [],
        deckCommitment: "x",
        totalPot: 600,
        startedAt: now,
      },
    });
    await prisma.handPlayer.create({
      data: { handId: hand.id, userId: user.id, seat: 1, position: "BTN", startingStack: 600, endingStack: 0, net: -600, holeCards: [] },
    });

    await expect(assertCanPlay(user.id, now)).rejects.toMatchObject({ code: "DAILY_LOSS_LIMIT" });

    const loosen = await updateResponsibleGamingLimits(user.id, { dailyLossLimit: 5_000 }, ctx, now);
    expect(loosen).toMatchObject({ ok: true, delayed: true });
    await expect(assertCanPlay(user.id, now)).rejects.toMatchObject({ code: "DAILY_LOSS_LIMIT" });

    const tighten = await updateResponsibleGamingLimits(user.id, { dailyLossLimit: 100 }, ctx, now);
    expect(tighten).toMatchObject({ ok: true, delayed: false });
  });
});

describe("account deletion", () => {
  it("anonymizes the user, keeps ledger rows and kills sessions", async () => {
    const user = await createTestUser({ username: "goodbye" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashUserPassword(STRONG) } });
    await prisma.session.create({ data: { sessionToken: "s1", userId: user.id, expires: new Date(Date.now() + 60_000) } });
    await prisma.ledgerEntry.create({
      data: { userId: user.id, delta: 5, balanceAfter: 5, type: "ADJUSTMENT", refKey: "keep-me" },
    });

    expect((await deleteAccount(user.id, { confirmation: "wrong", password: STRONG }, ctx)).ok).toBe(false);
    expect((await deleteAccount(user.id, { confirmation: "goodbye", password: "bad password" }, ctx)).ok).toBe(false);
    expect((await deleteAccount(user.id, { confirmation: "goodbye", password: STRONG }, ctx)).ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBeNull();
    expect(after.passwordHash).toBeNull();
    expect(after.username).toMatch(/^deleted_[0-9a-f]{12}$/);
    expect(after.deletedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { refKey: "keep-me" } })).toBe(1);
    expect(await getAuthenticatedSessionFromToken("s1")).toBeNull();
  });
});
