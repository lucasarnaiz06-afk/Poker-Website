// Enumerates all 133,784,560 seven-card hands and prints the category counts.
import { categoryOf, CATEGORY_NAMES, evaluate7 } from "../src/evaluator";

const counts = new Array<number>(9).fill(0);
const start = performance.now();
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++)
      for (let d = c + 1; d < 52; d++)
        for (let e = d + 1; e < 52; e++)
          for (let f = e + 1; f < 52; f++)
            for (let g = f + 1; g < 52; g++) counts[categoryOf(evaluate7(a, b, c, d, e, f, g))]!++;
const ms = performance.now() - start;
CATEGORY_NAMES.forEach((name, i) => console.log(`${name.padEnd(16)} ${counts[i]!.toLocaleString("en-US").padStart(12)}`));
const total = counts.reduce((x, y) => x + y, 0);
console.log(`total ${total.toLocaleString("en-US")} in ${ms.toFixed(0)} ms (${Math.round((total / ms) * 1000).toLocaleString("en-US")}/s)`);
