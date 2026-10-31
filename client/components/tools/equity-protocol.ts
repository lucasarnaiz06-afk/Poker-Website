// Messages between the UI and the equity Web Worker.
export type EquityRequest =
  | {
      id: number;
      kind: "hands";
      variant: "NLHE" | "PLO";
      hands: string[][];
      board: string[];
      dead: string[];
      iterations?: number;
      maxExactEvaluations?: number;
    }
  | {
      id: number;
      kind: "ranges";
      /** Per player: a range string ("AKs, TT+") or exact cards. */
      players: Array<{ range: string } | { cards: string[] }>;
      board: string[];
      dead: string[];
      iterations?: number;
    };

export type EquityResponse =
  | {
      id: number;
      ok: true;
      exact: boolean;
      samples: number;
      ms: number;
      results: Array<{ win: number; tie: number; equity: number }>;
      /** Combos per player after removing blocked cards (range mode). */
      combos?: number[];
    }
  | { id: number; ok: false; error: string };
