// Pure side-game payout rules (see docs/ARCHITECTURE.md "Side games"). Amounts are integers.

export type SeatStack = { userId: string; seat: number; stack: number };

export type Transfer = {
  fromUserId: string;
  fromSeat: number;
  toUserId: string;
  toSeat: number;
  amount: number;
};

/** Seats ordered clockwise starting left of `fromSeat`. */
export function clockwiseFrom<T extends { seat: number }>(items: readonly T[], fromSeat: number): T[] {
  const after = items.filter((item) => item.seat > fromSeat).sort((a, b) => a.seat - b.seat);
  const before = items.filter((item) => item.seat <= fromSeat).sort((a, b) => a.seat - b.seat);
  return [...after, ...before];
}

/**
 * Nit game: the last nit pays `penalty` to every other participant. The total is capped by the payer's
 * stack; when it runs short, recipients are paid clockwise from the payer's left.
 */
export function nitPenaltyTransfers(payer: SeatStack, recipients: readonly SeatStack[], penalty: number): Transfer[] {
  const transfers: Transfer[] = [];
  let remaining = payer.stack;
  for (const recipient of clockwiseFrom(
    recipients.filter((r) => r.userId !== payer.userId),
    payer.seat,
  )) {
    const amount = Math.min(penalty, remaining);
    if (amount <= 0) break;
    remaining -= amount;
    transfers.push({
      fromUserId: payer.userId,
      fromSeat: payer.seat,
      toUserId: recipient.userId,
      toSeat: recipient.seat,
      amount,
    });
  }
  return transfers;
}

/** 7-2 bounty: every payer (other dealt-in players) pays `bounty` to the winner, capped by their own stack. */
export function bountyTransfers(winner: SeatStack, payers: readonly SeatStack[], bounty: number): Transfer[] {
  const transfers: Transfer[] = [];
  for (const payer of clockwiseFrom(
    payers.filter((p) => p.userId !== winner.userId),
    winner.seat,
  )) {
    const amount = Math.min(bounty, payer.stack);
    if (amount <= 0) continue;
    transfers.push({
      fromUserId: payer.userId,
      fromSeat: payer.seat,
      toUserId: winner.userId,
      toSeat: winner.seat,
      amount,
    });
  }
  return transfers;
}

/** Applies transfers to a stack map (mutates and returns it). Throws if a stack would go negative. */
export function applyTransfers(stacks: Map<string, number>, transfers: readonly Transfer[]) {
  for (const transfer of transfers) {
    const from = stacks.get(transfer.fromUserId) ?? 0;
    if (from < transfer.amount) throw new Error("Side payment exceeds stack");
    stacks.set(transfer.fromUserId, from - transfer.amount);
    stacks.set(transfer.toUserId, (stacks.get(transfer.toUserId) ?? 0) + transfer.amount);
  }
  return stacks;
}

export type VoteTally = { eligible: number; yes: number; no: number };

/** Vote outcome so far: PASSED / FAILED as soon as it is decided, OPEN otherwise. */
export function evaluateVote(rule: "majority" | "unanimous", tally: VoteTally, expired: boolean) {
  const { eligible, yes, no } = tally;
  if (rule === "unanimous") {
    if (no > 0) return "FAILED" as const;
    if (eligible > 0 && yes >= eligible) return "PASSED" as const;
    return expired ? ("FAILED" as const) : ("OPEN" as const);
  }
  if (yes * 2 > eligible) return "PASSED" as const;
  // Even if every remaining voter says yes it cannot pass.
  if ((eligible - no) * 2 <= eligible) return "FAILED" as const;
  return expired ? ("FAILED" as const) : ("OPEN" as const);
}
