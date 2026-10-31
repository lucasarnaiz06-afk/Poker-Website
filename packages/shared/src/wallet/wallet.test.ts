import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import {
  buyIn,
  cashOut,
  claimDailyBonus,
  claimRefill,
  credit,
  dailyBonusAmount,
  debit,
  getBalance,
  getDailyBonusStatus,
  getRefillStatus,
  grantSignupBonus,
  listLedger,
  WalletError,
} from "./index";

async function ledgerSum(userId: string) {
  const result = await prisma.ledgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return result._sum.delta ?? 0;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("credit / debit", () => {
  it("writes a ledger entry with the resulting balance", async () => {
    const user = await createTestUser();
    const first = await credit({ userId: user.id, amount: 500, type: "ADJUSTMENT", refKey: "t:1" });
    const second = await debit({ userId: user.id, amount: 200, type: "BUY_IN", refKey: "t:2", lobbyId: null });

    expect(first.balance).toBe(500);
    expect(second.balance).toBe(300);
    expect(second.entry.delta).toBe(-200);
    expect(second.entry.balanceAfter).toBe(300);
    expect(await getBalance(user.id)).toBe(300);
    expect(await ledgerSum(user.id)).toBe(300);
  });

  it("rejects debits that would make the balance negative", async () => {
    const user = await createTestUser({ chipBalance: 0 });
    await credit({ userId: user.id, amount: 100, type: "ADJUSTMENT", refKey: "t:c" });

    await expect(debit({ userId: user.id, amount: 101, type: "BUY_IN", refKey: "t:d" })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await getBalance(user.id)).toBe(100);
    expect(await prisma.ledgerEntry.count({ where: { refKey: "t:d" } })).toBe(0);
  });

  it("rejects non-integer, zero, negative and oversized amounts", async () => {
    const user = await createTestUser();

    for (const amount of [0, -5, 1.5, Number.NaN, 2_000_000_000]) {
      await expect(credit({ userId: user.id, amount, type: "ADJUSTMENT", refKey: `bad:${amount}` })).rejects.toBeInstanceOf(
        WalletError,
      );
    }
  });

  it("rejects movement types in the wrong direction", async () => {
    const user = await createTestUser({ chipBalance: 1000 });
    await expect(credit({ userId: user.id, amount: 1, type: "BUY_IN", refKey: "dir:1" })).rejects.toBeInstanceOf(WalletError);
    await expect(debit({ userId: user.id, amount: 1, type: "CASH_OUT", refKey: "dir:2" })).rejects.toBeInstanceOf(WalletError);
  });

  it("reports unknown users", async () => {
    await expect(credit({ userId: "nope", amount: 1, type: "ADJUSTMENT", refKey: "nobody:1" })).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
  });

  it("is idempotent by refKey", async () => {
    const user = await createTestUser();
    const first = await credit({ userId: user.id, amount: 250, type: "CASH_OUT", refKey: "cash:1", lobbyId: null });
    const again = await credit({ userId: user.id, amount: 250, type: "CASH_OUT", refKey: "cash:1", lobbyId: null });

    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect(await getBalance(user.id)).toBe(250);
  });

  it("refuses to reuse a refKey for a different movement", async () => {
    const user = await createTestUser();
    await credit({ userId: user.id, amount: 250, type: "CASH_OUT", refKey: "cash:x" });

    await expect(credit({ userId: user.id, amount: 300, type: "CASH_OUT", refKey: "cash:x" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("the database CHECK constraint blocks negative balances even outside the service", async () => {
    const user = await createTestUser({ chipBalance: 10 });

    await expect(
      prisma.$executeRaw`UPDATE "User" SET "chipBalance" = -1 WHERE "id" = ${user.id}`,
    ).rejects.toThrow();
  });
});

describe("concurrency", () => {
  it("never overdraws under parallel debits", async () => {
    const user = await createTestUser();
    await credit({ userId: user.id, amount: 1_000, type: "ADJUSTMENT", refKey: "seed" });

    const attempts = Array.from({ length: 30 }, (_, index) =>
      buyIn(user.id, "lobby-1", 100, `buyin:${index}`).then(
        () => "ok" as const,
        (error: unknown) => (error instanceof WalletError ? error.code : "other"),
      ),
    );
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result === "ok")).toHaveLength(10);
    expect(results.filter((result) => result === "INSUFFICIENT_FUNDS")).toHaveLength(20);
    expect(await getBalance(user.id)).toBe(0);
    expect(await ledgerSum(user.id)).toBe(0);

    const entries = await prisma.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries.every((entry) => entry.balanceAfter >= 0)).toBe(true);
  });

  it("applies a refKey once when the same request is sent concurrently", async () => {
    const user = await createTestUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => cashOut(user.id, "lobby-1", 777, "cashout:same")),
    );

    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(777);
    expect(await prisma.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("keeps balance == sum(ledger) with mixed parallel credits and debits", async () => {
    const user = await createTestUser();
    await credit({ userId: user.id, amount: 500, type: "ADJUSTMENT", refKey: "mix:seed" });

    await Promise.allSettled(
      Array.from({ length: 40 }, (_, index) =>
        index % 2 === 0
          ? buyIn(user.id, "l", 60, `mix:d:${index}`)
          : cashOut(user.id, "l", 25, `mix:c:${index}`),
      ),
    );

    const balance = await getBalance(user.id);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(await ledgerSum(user.id)).toBe(balance);
  });
});

describe("bonuses", () => {
  it("grants the signup bonus once", async () => {
    const user = await createTestUser();
    await grantSignupBonus(user.id);
    await grantSignupBonus(user.id);

    expect(await getBalance(user.id)).toBe(10_000);
  });

  it("computes daily bonus amounts with a capped streak", () => {
    expect(dailyBonusAmount(1)).toBe(2_000);
    expect(dailyBonusAmount(2)).toBe(2_250);
    expect(dailyBonusAmount(7)).toBe(3_500);
    expect(dailyBonusAmount(30)).toBe(3_500);
  });

  it("grows the streak on consecutive days and resets after a gap", async () => {
    const user = await createTestUser();
    const day1 = new Date("2026-03-01T10:00:00Z");
    const day2 = new Date("2026-03-02T23:59:00Z");
    const day3 = new Date("2026-03-03T00:01:00Z");
    const day5 = new Date("2026-03-05T12:00:00Z");

    expect((await claimDailyBonus(user.id, day1)).streak).toBe(1);
    await expect(claimDailyBonus(user.id, new Date("2026-03-01T22:00:00Z"))).rejects.toMatchObject({
      code: "ALREADY_CLAIMED",
    });
    expect((await claimDailyBonus(user.id, day2)).streak).toBe(2);
    expect((await claimDailyBonus(user.id, day3)).streak).toBe(3);
    const afterGap = await claimDailyBonus(user.id, day5);
    expect(afterGap.streak).toBe(1);
    expect(afterGap.entry.delta).toBe(2_000);

    expect(await getBalance(user.id)).toBe(2_000 + 2_250 + 2_500 + 2_000);
    const status = await getDailyBonusStatus(user.id, new Date("2026-03-06T08:00:00Z"));
    expect(status).toMatchObject({ claimedToday: false, streak: 2, amount: 2_250 });
  });

  it("only one of many concurrent daily claims succeeds", async () => {
    const user = await createTestUser();
    const now = new Date("2026-04-01T12:00:00Z");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => claimDailyBonus(user.id, now)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(2_000);
  });

  it("blocks bonuses for users without a username or on a break", async () => {
    const noName = await createTestUser({ username: null });
    await expect(claimDailyBonus(noName.id)).rejects.toMatchObject({ code: "ACCOUNT_RESTRICTED" });

    const onBreak = await createTestUser();
    await prisma.responsibleGamingLimits.create({
      data: { userId: onBreak.id, coolOffUntil: new Date(Date.now() + 60_000) },
    });
    await expect(claimDailyBonus(onBreak.id)).rejects.toMatchObject({ code: "ACCOUNT_RESTRICTED" });
  });

  it("refills to 2,000 total once a day when wallet + table chips < 200", async () => {
    const user = await createTestUser({ chipBalance: 0 });
    const creator = await createTestUser();
    await credit({ userId: user.id, amount: 50, type: "ADJUSTMENT", refKey: "r:seed" });
    const lobby = await prisma.lobby.create({
      data: { name: "t", smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 200, createdByUserId: creator.id },
    });
    await prisma.lobbyPlayer.create({ data: { lobbyId: lobby.id, userId: user.id, seatNumber: 1, chipStack: 100 } });

    const now = new Date("2026-05-01T09:00:00Z");
    expect(await getRefillStatus(user.id, now)).toMatchObject({ eligible: true, amount: 1_850 });

    const refill = await claimRefill(user.id, now);
    expect(refill.entry.delta).toBe(1_850);
    expect(await getBalance(user.id)).toBe(1_900);

    await expect(claimRefill(user.id, now)).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
  });

  it("does not refill when the user still has 200+ chips", async () => {
    const user = await createTestUser();
    await credit({ userId: user.id, amount: 200, type: "ADJUSTMENT", refKey: "nr:seed" });
    await expect(claimRefill(user.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});

describe("listLedger", () => {
  it("paginates newest first", async () => {
    const user = await createTestUser();

    for (let index = 0; index < 7; index += 1) {
      await credit({ userId: user.id, amount: index + 1, type: "ADJUSTMENT", refKey: `p:${index}` });
    }

    const first = await listLedger(user.id, { take: 3 });
    const second = await listLedger(user.id, { take: 3, cursor: first.nextCursor });
    const third = await listLedger(user.id, { take: 3, cursor: second.nextCursor });

    expect(first.entries.map((entry) => entry.delta)).toEqual([7, 6, 5]);
    expect(second.entries.map((entry) => entry.delta)).toEqual([4, 3, 2]);
    expect(third.entries.map((entry) => entry.delta)).toEqual([1]);
    expect(third.nextCursor).toBeNull();
  });
});
