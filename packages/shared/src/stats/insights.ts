// Plain-English insights for the player's own stats, adapted from the table-finder leak thresholds
// (playerdb/handstats.py LEAKS, herostats.py FREQ_SPOTS). Phrased kindly, shown only with enough sample.
import type { Ratio } from "./definitions";
import type { ResultLine, StatsHeadline } from "./report";

export type Insight = {
  id: string;
  tone: "good" | "tip" | "info";
  title: string;
  body: string;
  /** "Based on 412 hands" */
  basis: string;
};

/** Minimum samples (hands or opportunities) before an insight is shown. */
export const INSIGHT_MIN = {
  overall: 50,
  vpip: 50,
  pfrRatio: 50,
  limp: 30,
  threeBet: 25,
  foldToThreeBet: 15,
  cbet: 20,
  foldToCbet: 20,
  wtsd: 30,
  af: 15,
  wsd: 20,
  winRate: 200,
  position: 30,
  allIn: 10,
} as const;

function basis(n: number, what: string) {
  return `Based on ${n.toLocaleString("en-US")} ${what}${n === 1 ? "" : "s"}`;
}

function pct(r: Ratio) {
  return `${Math.round(r.value ?? 0)}%`;
}

function enough(r: Ratio, min: number): r is Ratio & { value: number } {
  return r.value !== null && r.n >= min;
}

export function buildInsights(h: StatsHeadline, byPosition: readonly ResultLine[]): Insight[] {
  if (h.hands < INSIGHT_MIN.overall) {
    return [
      {
        id: "sample",
        tone: "info",
        title: "Insights unlock at 50 hands",
        body: `Play ${INSIGHT_MIN.overall - h.hands} more hand${INSIGHT_MIN.overall - h.hands === 1 ? "" : "s"} and we'll point out what's working and what to try next.`,
        basis: basis(h.hands, "hand"),
      },
    ];
  }
  const tips: Insight[] = [];
  const good: Insight[] = [];
  const info: Insight[] = [];

  if (enough(h.vpip, INSIGHT_MIN.vpip) && h.vpip.value > 45) {
    tips.push({
      id: "vpip-high",
      tone: "tip",
      title: "You play a lot of hands",
      body: `You put chips in before the flop in ${pct(h.vpip)} of hands. Most winning players stay around 20–30%; folding your weakest hands from early seats is an easy win.`,
      basis: basis(h.vpip.n, "hand"),
    });
  } else if (enough(h.vpip, 100) && h.vpip.value < 12) {
    tips.push({
      id: "vpip-low",
      tone: "tip",
      title: "You're playing very tight",
      body: `You only play ${pct(h.vpip)} of hands. That's safe, but you can open up from the button and cutoff, where position helps you most.`,
      basis: basis(h.vpip.n, "hand"),
    });
  }
  if (enough(h.vpip, INSIGHT_MIN.pfrRatio) && h.vpip.value >= 10 && h.pfr.value !== null && h.pfr.value / h.vpip.value < 0.35) {
    tips.push({
      id: "passive-preflop",
      tone: "tip",
      title: "You call more than you raise",
      body: `You raise in only ${Math.round((100 * h.pfr.value) / h.vpip.value)}% of the hands you play. Raising instead of calling lets you win pots right away and take the lead.`,
      basis: basis(h.vpip.n, "hand"),
    });
  }
  if (enough(h.limp, INSIGHT_MIN.limp) && h.limp.value > 5) {
    tips.push({
      id: "limp",
      tone: "tip",
      title: "Try raising instead of limping",
      body: `You limp (just call the big blind as your first move) in ${pct(h.limp)} of hands. When you're first in, raising or folding usually works better.`,
      basis: basis(h.limp.n, "hand"),
    });
  }
  if (enough(h.threeBet, INSIGHT_MIN.threeBet) && h.threeBet.value < 3) {
    tips.push({
      id: "three-bet-low",
      tone: "tip",
      title: "You rarely re-raise",
      body: `You 3-bet ${pct(h.threeBet)} of the time when someone raises. Re-raising your best hands (and a few bluffs) makes you harder to play against.`,
      basis: basis(h.threeBet.n, "spot"),
    });
  }
  if (enough(h.foldToThreeBet, INSIGHT_MIN.foldToThreeBet) && h.foldToThreeBet.value > 65) {
    tips.push({
      id: "fold-to-3bet",
      tone: "tip",
      title: "You fold to re-raises a lot",
      body: `After raising, you fold to a 3-bet ${pct(h.foldToThreeBet)} of the time. Opponents can re-raise you light; defend more of your strong opens.`,
      basis: basis(h.foldToThreeBet.n, "spot"),
    });
  }
  if (enough(h.cbet, INSIGHT_MIN.cbet) && h.cbet.value > 75) {
    tips.push({
      id: "cbet-high",
      tone: "tip",
      title: "You c-bet almost every flop",
      body: `You bet ${pct(h.cbet)} of flops after raising. Checking some weak hands on boards that don't suit you keeps opponents guessing.`,
      basis: basis(h.cbet.n, "flop"),
    });
  } else if (enough(h.cbet, INSIGHT_MIN.cbet) && h.cbet.value < 40) {
    tips.push({
      id: "cbet-low",
      tone: "tip",
      title: "You often give up after raising",
      body: `You follow up with a flop bet ${pct(h.cbet)} of the time. A small continuation bet wins many pots when your opponents miss.`,
      basis: basis(h.cbet.n, "flop"),
    });
  }
  if (enough(h.foldToCbet, INSIGHT_MIN.foldToCbet) && h.foldToCbet.value > 55) {
    tips.push({
      id: "fold-to-cbet",
      tone: "tip",
      title: "You fold to flop bets often",
      body: `You fold ${pct(h.foldToCbet)} of the time when the raiser bets the flop. Keep calling with pairs and good draws so you're not easy to push around.`,
      basis: basis(h.foldToCbet.n, "spot"),
    });
  }
  if (enough(h.wtsd, INSIGHT_MIN.wtsd) && h.wtsd.value > 33) {
    tips.push({
      id: "wtsd-high",
      tone: "tip",
      title: "You go to showdown a lot",
      body: `You see showdown in ${pct(h.wtsd)} of the flops you play. If you often lose there, try folding more of your weak pairs to big river bets.`,
      basis: basis(h.wtsd.n, "flop"),
    });
  }
  const afN = h.af.aggressive + h.af.calls;
  if (afN >= INSIGHT_MIN.af && h.af.value !== null && h.af.value < 1) {
    tips.push({
      id: "af-low",
      tone: "tip",
      title: "You're passive after the flop",
      body: `You call more often than you bet or raise after the flop (AF ${h.af.value.toFixed(1)}). Betting your strong hands builds bigger pots when you're ahead.`,
      basis: basis(afN, "postflop action"),
    });
  }

  if (enough(h.wsd, INSIGHT_MIN.wsd) && h.wsd.value >= 55) {
    good.push({
      id: "wsd-good",
      tone: "good",
      title: "You win most showdowns",
      body: `You win ${pct(h.wsd)} of the time the cards are turned over. Your hand reading is paying off.`,
      basis: basis(h.wsd.n, "showdown"),
    });
  }
  if (h.hands >= INSIGHT_MIN.winRate && h.bb100 !== null && h.bb100 > 0) {
    good.push({
      id: "winning",
      tone: "good",
      title: "You're winning",
      body: `+${h.bb100.toFixed(1)} big blinds per 100 hands. Results swing a lot over short samples, so keep the good habits going.`,
      basis: basis(h.hands, "hand"),
    });
  }
  const ranked = byPosition.filter((p) => p.hands >= INSIGHT_MIN.position && p.bb100 !== null);
  if (ranked.length >= 3) {
    const best = [...ranked].sort((a, b) => b.bb100! - a.bb100!)[0]!;
    if (best.bb100! > 0) {
      good.push({
        id: "best-position",
        tone: "good",
        title: `Your best position: ${best.label}`,
        body:
          best.key === "BTN" || best.key === "CO"
            ? `You win ${best.bb100!.toFixed(1)} bb/100 from the ${best.label.toLowerCase()}. Acting last helps, so it's a good seat to play a few more hands from.`
            : `You win ${best.bb100!.toFixed(1)} bb/100 from ${best.label}. Whatever you're doing there is working.`,
        basis: basis(best.hands, "hand"),
      });
    }
  }
  if (h.allInHands >= INSIGHT_MIN.allIn) {
    const diff = h.net - h.allInEvNet;
    const bb = h.netBB - h.allInEvBB;
    if (Math.abs(bb) >= 5) {
      info.push({
        id: "all-in-luck",
        tone: "info",
        title: diff < 0 ? "You've been unlucky in all-ins" : "You've run well in all-ins",
        body:
          diff < 0
            ? `Based on everyone's cards, you'd expect ${Math.abs(Math.round(bb))} more big blinds from your all-ins. That's variance, not a mistake.`
            : `You've won ${Math.round(bb)} big blinds more than expected in all-ins. Enjoy it, but expect it to even out.`,
        basis: basis(h.allInHands, "all-in hand"),
      });
    }
  }
  return [...tips.slice(0, 4), ...good, ...info].slice(0, 6);
}
