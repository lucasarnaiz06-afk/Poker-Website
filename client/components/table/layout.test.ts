import { describe, expect, it } from "vitest";
import { boardSize, computeTableLayout, intersects, type Box, type TableLayout } from "./layout";

const SIZES: Array<[number, number]> = [
  [367, 607], // 375x812 phone
  [367, 460], // short phone
  [928, 480], // 1280x720 with the side panel
  [1088, 667], // 1440x900 with the side panel
  [1568, 820], // 1920x1080 with the side panel
];

function layout(width: number, height: number, maxPlayers: number, holeCards = 2, boards = 1, heroSeat: number | null = 1) {
  const occupied = new Set(Array.from({ length: maxPlayers }, (_, i) => i + 1));
  return computeTableLayout({ width, height, maxPlayers, anchorSeat: 1, heroSeat, occupied, holeCards, boards, sidePots: false })!;
}

function boardBox(l: TableLayout): Box {
  const { x, y, width, height } = l.board;
  return { l: x - width / 2, r: x + width / 2, t: y - height / 2, b: y + height / 2 };
}

describe("computeTableLayout", () => {
  for (const [w, h] of SIZES) {
    for (const n of [2, 6, 9]) {
      for (const [hole, boards] of [
        [2, 1],
        [4, 1],
        [2, 2],
      ]) {
        it(`${w}x${h}, ${n} seats, ${hole} cards, ${boards} board(s): nothing overlaps`, () => {
          const l = layout(w, h, n, hole, boards);
          const seats = [...l.seats.values()];
          // Seats never touch each other.
          for (let i = 0; i < seats.length; i += 1) {
            for (let j = i + 1; j < seats.length; j += 1) {
              const hit = seats[i].parts.some((a) => seats[j].parts.some((b) => intersects(a, b)));
              expect(hit, `seat ${seats[i].seat} x seat ${seats[j].seat}`).toBe(false);
            }
          }
          // The board clears every seat and every bet-chip spot.
          const board = boardBox(l);
          for (const s of seats) {
            expect(s.parts.some((p) => intersects(p, board)), `board x seat ${s.seat}`).toBe(false);
            const chip = { l: s.chip.x - l.m.chipW / 2, r: s.chip.x + l.m.chipW / 2, t: s.chip.y - l.m.chipH / 2, b: s.chip.y + l.m.chipH / 2 };
            expect(intersects(chip, board), `board x chip ${s.seat}`).toBe(false);
          }
          // Everything stays inside the container.
          for (const s of seats) {
            expect(s.box.l).toBeGreaterThanOrEqual(0);
            expect(s.box.r).toBeLessThanOrEqual(w);
            expect(s.box.t).toBeGreaterThanOrEqual(0);
            expect(s.box.b).toBeLessThanOrEqual(h);
          }
        });
      }
    }
  }

  it("keeps the viewer's cards large on desktop and readable on phones", () => {
    expect(layout(1088, 667, 6).m.heroCardW).toBeGreaterThanOrEqual(64);
    expect(layout(367, 607, 6).m.heroCardW).toBeGreaterThanOrEqual(50);
    expect(layout(367, 607, 6, 4).m.heroCardW).toBeGreaterThanOrEqual(44);
  });

  it("grows the table with the screen", () => {
    expect(layout(1568, 820, 6).board.cardW).toBeGreaterThan(layout(928, 480, 6).board.cardW);
    expect(layout(1568, 820, 6).m.avatar).toBeGreaterThan(layout(928, 480, 6).m.avatar);
  });

  it("sizes double boards from the same card width", () => {
    const one = boardSize(50, 1);
    const two = boardSize(50, 2);
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.innerW).toBeLessThan(one.innerW);
  });
});
