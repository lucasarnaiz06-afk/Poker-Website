// Runs the engine's equity calculator off the main thread so the UI never freezes.
import { calculateEquity, calculateRangeEquity, EngineError, parseRange, type Card } from "@poker-platform/engine";
import type { EquityRequest, EquityResponse } from "./equity-protocol";

const ctx = self as unknown as {
  postMessage(message: EquityResponse): void;
  onmessage: ((event: MessageEvent<EquityRequest>) => void) | null;
};

function run(req: EquityRequest): EquityResponse {
  const started = performance.now();
  if (req.kind === "hands") {
    const result = calculateEquity({
      hands: req.hands as Card[][],
      board: req.board as Card[],
      dead: req.dead as Card[],
      variant: req.variant,
      iterations: req.iterations,
      maxExactEvaluations: req.maxExactEvaluations,
    });
    return { id: req.id, ok: true, exact: result.exact, samples: result.samples, ms: performance.now() - started, results: result.results };
  }
  const blocked = new Set([...req.board, ...req.dead]);
  for (const p of req.players) if ("cards" in p) p.cards.forEach((c) => blocked.add(c));
  const ranges = req.players.map((p, i) => {
    if ("cards" in p) return [p.cards as Card[]];
    const combos = parseRange(p.range);
    if (combos.length === 0) throw new EngineError("INVALID_RANGE", `Player ${i + 1}: enter a range like "AKs, TT+"`);
    return combos;
  });
  const combos = ranges.map((r, i) => ("cards" in req.players[i]! ? 1 : r.filter((c) => !c.some((card) => blocked.has(card))).length));
  const result = calculateRangeEquity({
    ranges,
    board: req.board as Card[],
    dead: req.dead as Card[],
    variant: "NLHE",
    iterations: req.iterations ?? 40_000,
  });
  return { id: req.id, ok: true, exact: false, samples: result.samples, ms: performance.now() - started, results: result.results, combos };
}

ctx.onmessage = (event: MessageEvent<EquityRequest>) => {
  const req = event.data;
  try {
    ctx.postMessage(run(req));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not calculate equity";
    ctx.postMessage({ id: req.id, ok: false, error: message } satisfies EquityResponse);
  }
};
