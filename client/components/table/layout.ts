// Pure table geometry (no React). Every element on the felt gets a box here, and the board is sized
// to the largest card that fits between the seats, so nothing on the table can overlap.
import { ovalPoints } from "./logic";

export type Box = { l: number; t: number; r: number; b: number };
export type Pt = { x: number; y: number };

export type SeatMetrics = {
  tier: "sm" | "md" | "lg";
  avatar: number;
  plateW: number;
  plateH: number;
  /** Face-up cards in front of other players. */
  cardW: number;
  /** Face-down cards peeking out behind other players' avatars. */
  backW: number;
  heroCardW: number;
  heroPlateW: number;
  heroAvatar: number;
  chipW: number;
  chipH: number;
  dealer: number;
};

/** Gap between a player's name plate and the action/hand tag under it, and the tag's height. */
export const TAG_GAP = 4;
export const TAG_H = 18;
/** How far the plate overlaps the bottom of the avatar. */
export const PLATE_OVERLAP = 6;
/** Gap between the hero's cards and their name plate (clears the fan's rotated corners and shadow). */
export const HERO_CARD_GAP = 8;
/** Share of a face-down card that peeks out above the avatar. */
export const BACK_PEEK = 0.55;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function metricsFor(width: number, height: number, portrait: boolean, maxPlayers: number): SeatMetrics {
  const crowded = maxPlayers > 6;
  if (portrait || width < 560) {
    // Short phones (or a vote card above the table) get slightly smaller seats.
    const k = clamp(height / 600, 0.84, 1);
    const r = (v: number) => Math.round(v * k);
    return {
      tier: "sm",
      avatar: r(crowded ? 34 : 38),
      plateW: r(crowded ? 74 : 84),
      plateH: 36,
      cardW: r(crowded ? 27 : 30),
      backW: r(crowded ? 18 : 20),
      heroCardW: r(crowded ? 50 : 56),
      heroPlateW: crowded ? 128 : 140,
      heroAvatar: 26,
      chipW: 58,
      chipH: 22,
      dealer: 18,
    };
  }
  // One unit that follows the space available, so 1280, 1440 and 1920 wide screens all look full.
  const u = clamp(Math.min(width / 1000, height / 540), 0.8, 1.3);
  const crowd = crowded ? 0.92 : 1;
  const lg = u >= 1.15;
  const cardW = Math.round(38 * u);
  return {
    tier: lg ? "lg" : "md",
    avatar: Math.round(48 * u * crowd),
    plateW: Math.round(104 * u * crowd),
    plateH: lg ? 46 : 42,
    cardW,
    backW: Math.round(cardW * 0.68),
    heroCardW: Math.round(64 * u),
    heroPlateW: Math.round(150 * u),
    heroAvatar: lg ? 34 : 30,
    chipW: lg ? 80 : 74,
    chipH: lg ? 26 : 24,
    dealer: lg ? 22 : 20,
  };
}

/** Horizontal overlap (share of a card's width) for a fanned hand. */
export function fanOverlap(count: number, hero: boolean) {
  if (count > 2) return hero ? 0.42 : 0.45;
  return hero ? 0.1 : 0.06;
}

export function fanWidth(count: number, cardW: number, hero: boolean) {
  if (count <= 0) return 0;
  return cardW + (count - 1) * cardW * (1 - fanOverlap(count, hero));
}

/**
 * Footprint of a seat relative to its anchor (hero: plate centre, others: avatar centre), as two
 * boxes: the narrow cards/avatar part on top and the wider name plate + tag below it.
 */
export function seatParts(m: SeatMetrics, hero: boolean, cardCount: number): Box[] {
  if (hero) {
    const cardsHalf = (fanWidth(Math.max(2, cardCount), m.heroCardW, true) + 6) / 2; // + rotation slack
    const plateTop = -m.plateH / 2;
    const top = plateTop - HERO_CARD_GAP - m.heroCardW * 1.4 - 4;
    const plateHalf = (m.heroPlateW + 16) / 2; // tags may be 16px wider than the plate
    return [
      { l: -cardsHalf, r: cardsHalf, t: top, b: plateTop },
      { l: -plateHalf, r: plateHalf, t: plateTop, b: m.plateH / 2 + TAG_GAP + TAG_H },
    ];
  }
  const shownHalf = fanWidth(Math.max(2, cardCount), m.cardW, false) / 2;
  const backsTop = -(m.avatar / 2 + m.backW * 1.4 * BACK_PEEK) - 2;
  const shownTop = m.avatar / 2 - 2 - m.cardW * 1.4;
  const plateTop = m.avatar / 2 - PLATE_OVERLAP;
  const topHalf = Math.max(m.avatar / 2 + 8, shownHalf); // + NIT / timer badges
  const plateHalf = Math.max(m.plateW / 2 + 8, shownHalf);
  // The dealer button sits on the plate's top corner, poking up by half its size.
  const plateTopEdge = plateTop - m.dealer / 2;
  return [
    { l: -topHalf, r: topHalf, t: Math.min(backsTop, shownTop), b: plateTopEdge },
    { l: -plateHalf, r: plateHalf, t: plateTopEdge, b: plateTop + m.plateH + TAG_GAP + TAG_H },
  ];
}

export const union = (boxes: Box[]): Box => ({
  l: Math.min(...boxes.map((b) => b.l)),
  r: Math.max(...boxes.map((b) => b.r)),
  t: Math.min(...boxes.map((b) => b.t)),
  b: Math.max(...boxes.map((b) => b.b)),
});

export const emptySeatBox = (m: SeatMetrics): Box => {
  const h = m.avatar / 2 + 4;
  return { l: -h, r: h, t: -h, b: h };
};

const shift = (b: Box, x: number, y: number): Box => ({ l: b.l + x, r: b.r + x, t: b.t + y, b: b.b + y });
const inflate = (b: Box, n: number): Box => ({ l: b.l - n, r: b.r + n, t: b.t - n, b: b.b + n });
export const intersects = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const rectAt = (x: number, y: number, w: number, h: number): Box => ({ l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 });

/** Parametric angles (degrees, 90 = bottom centre, clockwise on screen) for tall, phone-shaped ovals. */
const PORTRAIT_ANGLES: Record<number, number[]> = {
  2: [90, 270],
  3: [90, 210, 330],
  4: [90, 180, 270, 0],
  5: [90, 160, 235, 305, 20],
  6: [90, 145, 215, 270, 325, 35],
  7: [90, 145, 195, 245, 295, 345, 35],
  8: [90, 140, 185, 225, 270, 315, 355, 40],
  9: [90, 140, 175, 205, 245, 295, 335, 5, 40],
};

/** `spread` lifts the hero's two neighbours (degrees) to give the hero's cards room on phones. */
function seatPoints(n: number, rx: number, ry: number, portrait: boolean, spread: number): Pt[] {
  const angles = portrait ? PORTRAIT_ANGLES[n] : undefined;
  if (!angles) return ovalPoints(n, rx, ry);
  return angles.map((deg, v) => {
    const lifted = n > 2 && v === 1 ? deg + spread : n > 2 && v === n - 1 ? deg - spread : deg;
    const t = (lifted * Math.PI) / 180;
    return { x: rx * Math.cos(t), y: ry * Math.sin(t) };
  });
}

export type SeatSpot = {
  seat: number;
  /** Anchor in container px (hero: plate centre; others: avatar centre). */
  x: number;
  y: number;
  hero: boolean;
  occupied: boolean;
  placement: "top" | "bottom" | "side";
  /** Union of `parts`. */
  box: Box;
  parts: Box[];
  chip: Pt;
};

export type BoardSpot = {
  x: number;
  y: number;
  cardW: number;
  /** Card width actually used per board (double boards are drawn a bit smaller). */
  innerW: number;
  gap: number;
  width: number;
  height: number;
};

export type TableLayout = {
  width: number;
  height: number;
  portrait: boolean;
  m: SeatMetrics;
  felt: { left: number; top: number; width: number; height: number; rail: number };
  cx: number;
  cy: number;
  seats: Map<number, SeatSpot>;
  board: BoardSpot;
  /** Pot (and side pots) sit here: "above" = centred, bottom edge at `y`; "beside" = right edge at `x`, centred on `y`. */
  pot: { mode: "above" | "beside"; x: number; y: number; width: number };
  /** Where chips start when the pot is pushed to the winners. */
  potCentre: Pt;
  /** Hand-result banner: never over the board, cards or seats. Above the board `y` is its bottom edge, below it its top edge. */
  banner: { x: number; y: number; width: number; maxHeight: number; side: "above" | "below"; fits: boolean };
  /** Centre message / start button when there's no hand. */
  message: Pt;
};

export type LayoutInput = {
  width: number;
  height: number;
  maxPlayers: number;
  /** The seat drawn at the bottom centre. */
  anchorSeat: number;
  /** The viewer's seat (gets the large hero layout), if seated. */
  heroSeat: number | null;
  occupied: ReadonlySet<number>;
  /** Hole cards per seat (2 for Hold'em, 4 for PLO). */
  holeCards: number;
  boards: number;
  sidePots: boolean;
  /** Lines in the hand-result banner (winners, then side-game lines), when a result is showing. */
  result?: { lines: number; extras: number } | null;
};

/** Board block size for a given card width. */
export function boardSize(cardW: number, boards: number) {
  const multi = boards > 1;
  const innerW = multi ? Math.round(cardW * 0.86) : cardW;
  const gap = Math.max(4, Math.round(innerW * 0.1));
  const width = 5 * innerW + 4 * gap + (multi ? 20 + gap : 0);
  const height = boards * Math.round(innerW * 1.4) + (boards - 1) * (gap + 2);
  return { innerW, gap, width, height };
}

export function computeTableLayout(input: LayoutInput): TableLayout | null {
  if (input.width < 50 || input.height < 50) return null;
  const portrait = input.width / input.height < 0.95;
  return layoutWith(input, portrait, metricsFor(input.width, input.height, portrait, input.maxPlayers), 0, 0, NO_EXTRA);
}

/** Smaller hero cards (when they'd touch a neighbour) or smaller seats (when seats touch). */
function shrink(m: SeatMetrics, heroOnly: boolean): SeatMetrics {
  if (heroOnly) return { ...m, heroCardW: Math.round(m.heroCardW * 0.93) };
  const k = 0.94;
  return {
    ...m,
    avatar: Math.round(m.avatar * k),
    plateW: Math.round(m.plateW * k),
    cardW: Math.round(m.cardW * k),
    backW: Math.round(m.backW * k),
  };
}

type Extra = { top: number; bottom: number; x: number };
const NO_EXTRA: Extra = { top: 0, bottom: 0, x: 0 };

function layoutWith(
  input: LayoutInput,
  portrait: boolean,
  m: SeatMetrics,
  attempt: number,
  spread: number,
  extra: Extra,
): TableLayout | null {
  const { width: W, height: H, maxPlayers: n } = input;
  const heroParts = seatParts(m, true, input.holeCards);
  const otherParts = seatParts(m, false, input.holeCards);
  const heroBox = union(heroParts);
  const otherBox = union(otherParts);

  // Oval of seat anchors (the rail's centre line), padded so every seat stays on screen.
  const padX = -otherBox.l + 2 + extra.x;
  const padTop = -otherBox.t + 4 + extra.top;
  const bottomBox = input.heroSeat !== null && input.heroSeat === input.anchorSeat ? heroBox : otherBox;
  const padBottom = bottomBox.b + 4 + extra.bottom;
  let rx = W / 2 - padX;
  let ry = (H - padTop - padBottom) / 2;
  if (rx <= 0 || ry <= 0) return null;
  // Keep a pleasant oval: not a pill on ultra-wide screens, not a needle on tall phones.
  if (portrait) {
    rx = Math.min(rx, ry * 0.78);
    ry = Math.min(ry, rx / 0.5);
  } else {
    rx = Math.min(rx, ry * 2.25);
    ry = Math.min(ry, rx / 1.45);
  }
  const cx = W / 2;
  const cy = padTop + (H - padTop - padBottom) / 2;
  const rail = clamp(Math.min(rx, ry) * 0.05, 9, 16);
  const feltRx = rx + rail * 0.55;
  const feltRy = ry + rail * 0.55;
  const felt = { left: cx - feltRx, top: cy - feltRy, width: feltRx * 2, height: feltRy * 2, rail };
  // Playable interior (inside the rail), used to keep the board on the cloth.
  const inRx = feltRx - rail - 6;
  const inRy = feltRy - rail - 6;
  const insideFelt = (b: Box) =>
    [
      [b.l, b.t],
      [b.r, b.t],
      [b.l, b.b],
      [b.r, b.b],
    ].every(([x, y]) => ((x - cx) / inRx) ** 2 + ((y - cy) / inRy) ** 2 <= 1);

  // Seats.
  const pts = seatPoints(n, rx, ry, portrait, spread);
  const seats = new Map<number, SeatSpot>();
  for (let i = 0; i < n; i += 1) {
    const seatNo = i + 1;
    const p = pts[(seatNo - input.anchorSeat + n) % n];
    const hero = seatNo === input.heroSeat;
    const occupied = input.occupied.has(seatNo);
    const x = cx + p.x;
    const y = cy + p.y;
    const parts = (hero ? heroParts : occupied ? otherParts : [emptySeatBox(m)]).map((b) => shift(b, x, y));
    const band = portrait ? 0.72 : 0.55;
    const placement: SeatSpot["placement"] = p.y > ry * band ? "bottom" : p.y < -ry * band ? "top" : "side";
    seats.set(seatNo, { seat: seatNo, x, y, hero, occupied, placement, box: union(parts), parts, chip: { x, y } });
  }

  // Seats must never touch. On phones first lift the hero's neighbours a little, then shrink the
  // hero's cards or the seats, and lay out again.
  if (attempt < 8) {
    const list = [...seats.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a.parts.some((pa) => b.parts.some((pb) => intersects(pa, pb)))) continue;
        const heroInvolved = a.hero || b.hero;
        if (heroInvolved && portrait && spread < 12 && PORTRAIT_ANGLES[n]) {
          return layoutWith(input, portrait, m, attempt + 1, spread + 4, extra);
        }
        const heroOnly = heroInvolved && m.heroCardW > m.cardW * 1.5;
        return layoutWith(input, portrait, shrink(m, heroOnly), attempt + 1, spread, extra);
      }
    }
    // Seats next to the top / bottom one can reach further out than it does: pad and retry.
    const all = [...seats.values()].map((s) => s.box);
    const over = {
      top: Math.max(0, 2 - Math.min(...all.map((b) => b.t))),
      bottom: Math.max(0, Math.max(...all.map((b) => b.b)) - (H - 2)),
      x: Math.max(0, 2 - Math.min(...all.map((b) => b.l)), Math.max(...all.map((b) => b.r)) - (W - 2)),
    };
    if (over.top > 0.5 || over.bottom > 0.5 || over.x > 0.5) {
      const next = { top: extra.top + over.top, bottom: extra.bottom + over.bottom, x: extra.x + over.x };
      return layoutWith(input, portrait, m, attempt + 1, spread, next);
    }
  }

  const seatBoxes = [...seats.values()].flatMap((s) => s.parts);
  const occupiedSeats = [...seats.values()].filter((s) => s.occupied);
  const clearOfSeats = (b: Box, except: number) =>
    [...seats.values()].every((s) => s.seat === except || s.parts.every((p) => !intersects(b, p)));
  const inView = (b: Box) => b.l >= 2 && b.t >= 2 && b.r <= W - 2 && b.b <= H - 2;
  const chipAt = (p: Pt) => rectAt(p.x, p.y, m.chipW, m.chipH);

  // Bet chip spots: just outside each seat, toward the middle of the table. A seat can use its
  // second-choice direction (`alt`) when that leaves the board more room; a spot that would touch
  // a seat, another chip or (`avoid`) the board is never used while a clear one exists.
  type Placement = { heroAbove: boolean; alt: ReadonlySet<number> };
  const rowKey = (s: SeatSpot) => Math.round((s.y - cy) / 8);
  const chipCandidates = (
    s: SeatSpot,
    heroAbove: boolean,
    useAlt: boolean,
    blocked: (b: Box) => boolean,
    stop: (b: Box) => boolean,
  ): Pt[] => {
    const relX = s.x - cx;
    const relY = s.y - cy;
    if (s.hero) {
      const cardsTop = s.box.t;
      const cardsBottom = s.y - m.plateH / 2;
      const cardsW = fanWidth(Math.max(2, input.holeCards), m.heroCardW, true);
      const above = { x: s.x, y: cardsTop - 8 - m.chipH / 2 };
      const left = { x: s.x - cardsW / 2 - 14 - m.chipW / 2, y: cardsTop + (cardsBottom - cardsTop) * 0.35 };
      const right = { x: s.x + cardsW / 2 + 14 + m.chipW / 2, y: left.y };
      return heroAbove ? [above, left, right] : [left, above, right];
    }
    // Candidate directions, most natural first.
    const dirs: Array<[number, number]> = [];
    const sx = -Math.sign(relX) || 1;
    const sy = -Math.sign(relY) || 1;
    if (portrait) {
      if (s.placement === "side") dirs.push([sx, 0], [0, sy]);
      else dirs.push([0, sy], [sx, 0]);
    } else {
      // Blend of "toward the centre" and the oval's inward normal: reads naturally on wide ovals.
      const len = Math.hypot(relX, relY) || 1;
      const nx = -relX / (rx * rx);
      const ny = -relY / (ry * ry);
      const nlen = Math.hypot(nx, ny) || 1;
      const bx = -relX / len + nx / nlen;
      const by = -relY / len + ny / nlen;
      const blen = Math.hypot(bx, by) || 1;
      dirs.push([bx / blen, by / blen], Math.abs(relX) > Math.abs(relY) ? [sx, 0] : [0, sy]);
    }
    if (useAlt) [dirs[0], dirs[1]] = [dirs[1], dirs[0]];
    return dirs.map(([dx, dy]) => {
      // Walk out from the seat until the chip clears it. Sideways chips ride at avatar height,
      // beside the narrow avatar rather than the wider name plate.
      const plateTop = s.parts.length > 1 ? s.parts[1].t - s.y : 0;
      const lift = Math.abs(dy) < 0.5 ? Math.min(-m.chipH * 0.4, plateTop - 6 - m.chipH / 2) : 0;
      const at = (t: number) => ({ x: s.x + dx * t, y: s.y + lift + dy * t });
      let t = 0;
      while (t < 600 && s.parts.some((p) => intersects(chipAt(at(t)), inflate(p, 6)))) t += 2;
      // Then past anything already placed (other chips), but never more than halfway to the centre.
      const limit = t + Math.hypot(relX, relY) * 0.45;
      while (t < limit && blocked(chipAt(at(t))) && !stop(chipAt(at(t + 2)))) t += 2;
      const p = at(t);
      // Keep the chip on screen (seats hug the edges on phones).
      return { x: clamp(p.x, m.chipW / 2 + 2, W - m.chipW / 2 - 2), y: clamp(p.y, m.chipH / 2 + 2, H - m.chipH / 2 - 2) };
    });
  };
  const place = ({ heroAbove, alt }: Placement, avoid: Box[] = []): boolean => {
    let allClear = true;
    const placed: Box[] = [...avoid];
    const free = (b: Box) => inView(b) && !placed.some((p) => intersects(b, inflate(p, 4)));
    // Hero first (a fixed choice), then mirrored rows of seats together so both sides match.
    const rows = new Map<string, SeatSpot[]>();
    for (const s of occupiedSeats) {
      const key = s.hero ? "hero" : String(rowKey(s));
      rows.set(key, [...(rows.get(key) ?? []), s]);
    }
    // Hero first, then side rows (nearest the middle first), then top / bottom seats, which can
    // push their chip a little further in to clear the side chips.
    const rank = ([key, row]: [string, SeatSpot[]]) =>
      key === "hero" ? -1 : (row[0].placement === "side" ? 0 : 1000) + Math.abs(row[0].y - cy);
    const ordered = [...rows.entries()].sort((a, b) => rank(a) - rank(b));
    for (const [, row] of ordered) {
      // Walk past other chips and seats, but never onto the board / pot.
      const blocked = (b: Box) => !free(b) || !clearOfSeats(b, -1);
      const stop = (b: Box) => avoid.some((a) => intersects(b, a));
      const options = row.map((s) => chipCandidates(s, heroAbove, alt.has(s.seat), blocked, stop));
      const fits = (k: number) => {
        const rects = options.map((o) => chipAt(o[Math.min(k, o.length - 1)]));
        return rects.every(
          (r, i) => clearOfSeats(r, row[i].hero ? row[i].seat : -1) && free(r) && rects.every((q, j) => j === i || !intersects(r, inflate(q, 4))),
        );
      };
      const k = [0, 1].find(fits);
      row.forEach((s, i) => {
        const o = options[i];
        const clear = o.find((p) => clearOfSeats(chipAt(p), s.hero ? s.seat : -1) && free(chipAt(p)));
        if (k === undefined && !clear) allClear = false;
        // No clear spot at all: at least stay off the board.
        const offBoard = o.find((p) => !avoid.some((a) => intersects(chipAt(p), a)));
        s.chip = k !== undefined ? o[Math.min(k, o.length - 1)] : (clear ?? offBoard ?? o[0]);
        placed.push(chipAt(s.chip));
      });
    }
    return allClear;
  };

  // Board fit: the largest card size whose board (plus the pot above it) clears every seat and
  // chip spot, positioned as centrally as possible.
  const maxCardW = portrait || m.tier === "sm" ? 50 : Math.round(m.cardW * 1.65);
  const minCardW = portrait || m.tier === "sm" ? 26 : 32;
  const potH = input.sidePots ? 52 : 30;
  type Fit = { cardW: number; y: number; mode: "above" | "beside" };
  const potRect = (mode: Fit["mode"], board: Box, y: number): Box => {
    const bw = board.r - board.l;
    return mode === "above"
      ? { l: cx - Math.max(bw, 180) / 2, r: cx + Math.max(bw, 180) / 2, t: board.t - 8 - potH, b: board.t - 8 }
      : { l: board.l - 12 - 150, r: board.l - 12, t: y - potH / 2, b: y + potH / 2 };
  };
  const solve = (mode: Fit["mode"], floor: number, withChips = true): Fit | null => {
    const obstacles = [...seatBoxes, ...(withChips ? occupiedSeats.map((s) => chipAt(s.chip)) : [])].map((b) => inflate(b, 6));
    const clear = (b: Box) => obstacles.every((o) => !intersects(b, o));
    const range = Math.round(ry * 0.5);
    for (let w = maxCardW; w >= floor; w -= 1) {
      const { width: bw, height: bh } = boardSize(w, input.boards);
      const ok: number[] = [];
      for (let off = -range; off <= range; off += 2) {
        const y = cy + off;
        const board = rectAt(cx, y, bw, bh);
        const pot = potRect(mode, board, y);
        if (insideFelt(board) && insideFelt(pot) && clear(board) && clear(pot)) ok.push(y);
      }
      if (ok.length > 0) {
        // Centre within the feasible band (balanced between whatever is above and below).
        const mid = (ok[0] + ok[ok.length - 1]) / 2;
        const y = ok.reduce((best, v) => (Math.abs(v - mid) < Math.abs(best - mid) ? v : best), ok[0]);
        return { cardW: w, y, mode };
      }
    }
    return null;
  };
  const evaluate = (p: Placement, floor = minCardW): Fit | null => {
    place(p);
    const a = solve("above", floor);
    const b = portrait ? null : solve("beside", Math.max(floor, (a?.cardW ?? 0) + 7));
    return b ?? a;
  };

  const heroSeated = input.heroSeat !== null && seats.has(input.heroSeat);
  let placement: Placement = { heroAbove: true, alt: new Set() };
  let fit = evaluate(placement);
  // An unusual chip spot is only worth it for a clearly bigger board.
  const better = (f: Fit | null) => f !== null && (fit === null || f.cardW >= fit.cardW + 4);
  if (heroSeated && (!fit || fit.cardW < maxCardW * 0.92)) {
    const alt = { ...placement, heroAbove: false };
    const f = evaluate(alt, (fit?.cardW ?? minCardW - 4) + 4);
    if (better(f)) [placement, fit] = [alt, f];
  }
  // Try mirrored pairs of seats with their second-choice chip direction.
  if (!fit || fit.cardW < maxCardW) {
    // Only side seats: a top or bottom seat's chip always sits straight toward the board.
    const rows = new Map<number, number[]>();
    for (const s of occupiedSeats) {
      if (s.hero || s.placement !== "side") continue;
      const key = rowKey(s);
      rows.set(key, [...(rows.get(key) ?? []), s.seat]);
    }
    for (const row of rows.values()) {
      const alt = { ...placement, alt: new Set([...placement.alt, ...row]) };
      const f = evaluate(alt, (fit?.cardW ?? minCardW - 4) + 4);
      if (better(f)) [placement, fit] = [alt, f];
    }
  }
  // Crowded table (small board): fit the board between the seats first, then tuck the chips around
  // it, when every chip still finds a clear spot.
  const boardFirst = !fit || fit.cardW < maxCardW * 0.8 ? solve("above", (fit?.cardW ?? minCardW - 10) + 6, false) : null;
  let placedAroundBoard = false;
  if (boardFirst) {
    const b = boardSize(boardFirst.cardW, input.boards);
    const boardBox = rectAt(cx, boardFirst.y, b.width, b.height);
    if (place(placement, [boardBox, potRect(boardFirst.mode, boardBox, boardFirst.y)]) || !fit) {
      fit = boardFirst;
      placedAroundBoard = true;
    }
  }
  if (!fit) fit = { cardW: minCardW, y: cy, mode: "above" };
  if (!placedAroundBoard) place(placement);

  const bs = boardSize(fit.cardW, input.boards);
  const board: BoardSpot = { x: cx, y: fit.y, cardW: fit.cardW, innerW: bs.innerW, gap: bs.gap, width: bs.width, height: bs.height };
  const boardRect = rectAt(cx, fit.y, bs.width, bs.height);
  const pot =
    fit.mode === "above"
      ? { mode: "above" as const, x: cx, y: boardRect.t - 8, width: Math.max(bs.width, 180) }
      : { mode: "beside" as const, x: boardRect.l - 12, y: fit.y, width: 150 };
  const potCentre = fit.mode === "above" ? { x: cx, y: boardRect.t - 8 - 15 } : { x: boardRect.l - 12 - 60, y: fit.y };

  // Result banner: the widest lane (above the board first, else below it) that fits its lines.
  const sm = m.tier === "sm";
  const res = input.result ?? { lines: 1, extras: 0 };
  const needH = res.lines * (sm ? 18 : 20) + (res.extras > 0 ? res.extras * 16 + 9 : 0) + (sm ? 14 : 18);
  const blockers = [...seatBoxes, ...occupiedSeats.map((s) => chipAt(s.chip))];
  const lane = (width: number) => {
    const col = { l: cx - width / 2, r: cx + width / 2 };
    const inCol = blockers.filter((b) => b.l < col.r && b.r > col.l);
    const aboveLimit = Math.max(felt.top + rail + 8, ...inCol.filter((b) => b.b <= boardRect.t).map((b) => b.b + 6));
    const belowLimit = Math.min(felt.top + felt.height - rail - 8, ...inCol.filter((b) => b.t >= boardRect.b).map((b) => b.t - 6));
    return { width, above: boardRect.t - 8 - aboveLimit, below: belowLimit - (boardRect.b + 8) };
  };
  const widths = (portrait || sm ? [W - 24, W - 72, bs.width + 16] : [440, 380, Math.max(bs.width + 48, 300)])
    .map((w) => Math.round(Math.min(w, W - 24)))
    .filter((w, i, all) => w > 0 && all.indexOf(w) === i);
  const lanes = widths.map(lane);
  const pick =
    lanes.find((l) => l.above >= needH) ??
    lanes.find((l) => l.below >= needH) ??
    lanes.reduce((a, b) => (Math.max(b.above, b.below) > Math.max(a.above, a.below) ? b : a));
  const useAbove = pick.above >= needH || pick.above >= pick.below;
  const fits = Math.max(pick.above, pick.below) >= needH;
  const banner: TableLayout["banner"] = useAbove
    ? { x: cx, y: boardRect.t - 8, width: pick.width, maxHeight: Math.max(0, Math.min(pick.above, 160)), side: "above", fits }
    : { x: cx, y: boardRect.b + 8, width: pick.width, maxHeight: Math.max(0, Math.min(pick.below, 160)), side: "below", fits };

  return { width: W, height: H, portrait, m, felt, cx, cy, seats, board, pot, potCentre, banner, message: { x: cx, y: fit.y } };
}
