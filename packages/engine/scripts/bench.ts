// Evaluator / equity benchmark: `npm run bench --workspace packages/engine`
import { calculateEquity } from "../src/equity";
import { evaluate7, evaluateIndices } from "../src/evaluator";
import { evaluateOmahaIndices } from "../src/omaha";

function randomHands(count: number, size: number): Int32Array {
  const out = new Int32Array(count * size);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let h = 0; h < count; h++) {
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(Math.random() * (52 - i));
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
      out[h * size + i] = deck[i]!;
    }
  }
  return out;
}

function bench(label: string, n: number, fn: () => number): void {
  fn(); // warm-up
  const start = performance.now();
  const checksum = fn();
  const ms = performance.now() - start;
  const perSec = Math.round((n / ms) * 1000);
  console.log(`${label.padEnd(44)} ${perSec.toLocaleString("en-US").padStart(14)} /s  (${ms.toFixed(0)} ms, checksum ${checksum})`);
}

const N = 2_000_000;
const hands7 = randomHands(N, 7);
bench("7-card evaluate7() random hands", N, () => {
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const o = i * 7;
    acc ^= evaluate7(hands7[o]!, hands7[o + 1]!, hands7[o + 2]!, hands7[o + 3]!, hands7[o + 4]!, hands7[o + 5]!, hands7[o + 6]!);
  }
  return acc;
});
bench("7-card evaluateIndices() random hands", N, () => {
  let acc = 0;
  for (let i = 0; i < N; i++) acc ^= evaluateIndices(hands7.subarray(i * 7, i * 7 + 7), 7);
  return acc;
});

// Exhaustive enumeration speed: all 7-card combos from a subset (C(40,7) ~ 18.6M would be slow; use 32 cards).
bench("7-card exhaustive C(30,7) = 2,035,800", 2_035_800, () => {
  let acc = 0;
  const n = 30;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            for (let f = e + 1; f < n; f++) for (let g = f + 1; g < n; g++) acc ^= evaluate7(a, b, c, d, e, f, g);
  return acc;
});

const M = 200_000;
const plo = randomHands(M, 9);
bench("PLO evaluateOmahaIndices() (4 hole + 5 board)", M, () => {
  let acc = 0;
  for (let i = 0; i < M; i++) acc ^= evaluateOmahaIndices(plo.subarray(i * 9, i * 9 + 4), plo.subarray(i * 9 + 4, i * 9 + 9));
  return acc;
});

function time(label: string, fn: () => unknown): void {
  const start = performance.now();
  const r = fn();
  console.log(`${label.padEnd(44)} ${(performance.now() - start).toFixed(0).padStart(8)} ms  ${JSON.stringify(r)}`);
}
time("equity AhAd vs KsKc preflop (exact)", () =>
  calculateEquity({ hands: [["Ah", "Ad"], ["Ks", "Kc"]], variant: "NLHE" }).results.map((r) => r.equity.toFixed(4)),
);
time("equity 3-way NLHE flop (exact)", () =>
  calculateEquity({ hands: [["Ah", "Ad"], ["Ks", "Kc"], ["9h", "8h"]], board: ["7h", "6c", "2h"], variant: "NLHE" }).results.map((r) =>
    r.equity.toFixed(4),
  ),
);
time("equity PLO HU preflop (Monte Carlo 20k)", () =>
  calculateEquity({ hands: [["Ah", "Ad", "Ks", "Kd"], ["9h", "8h", "7c", "6c"]], variant: "PLO" }).results.map((r) =>
    r.equity.toFixed(4),
  ),
);
