// Shared fixture: creates players on demand, remembers the tables a test hosts, and on teardown closes them
// and checks chip conservation (wallets + chips on tables == everything granted to the test's users).
import { test as base, expect } from "@playwright/test";
import { chipAudit } from "./db";
import { closeTableAs } from "./socket";
import { registerPlayer, type Player } from "./users";

type Game = {
  players: Player[];
  newPlayer: (prefix?: string) => Promise<Player>;
  newPlayers: (count: number, prefix?: string) => Promise<Player[]>;
  /** Registers a table hosted by `host` so teardown closes it. */
  hosted: (host: Player, tableId: string) => void;
  audit: () => Promise<void>;
};

export const test = base.extend<{ game: Game }>({
  game: async ({ browser }, use, testInfo) => {
    const players: Player[] = [];
    const tables: Array<{ host: Player; tableId: string }> = [];
    // Mid-test check at a hand boundary: wallets + persisted table stacks == grants (stacks are written when
    // a hand completes, so poll briefly for the write).
    const audit = async () => {
      if (players.length === 0) return;
      let last = "";
      await expect
        .poll(async () => {
          const result = await chipAudit(players.map((p) => p.username));
          last = JSON.stringify(result);
          return result.wallets + result.onTables - result.granted;
        }, { message: `chip conservation ${last}`, timeout: 10_000 })
        .toBe(0);
    };
    const game: Game = {
      players,
      newPlayer: async (prefix = "e2e") => {
        const player = await registerPlayer(browser, prefix);
        players.push(player);
        return player;
      },
      newPlayers: async (count, prefix = "p") => {
        const out: Player[] = [];
        for (let i = 0; i < count; i += 1) out.push(await game.newPlayer(`${prefix}${i + 1}`));
        return out;
      },
      hosted: (host, tableId) => tables.push({ host, tableId }),
      audit,
    };
    await use(game);

    for (const { host, tableId } of tables) {
      const res = await closeTableAs(host, tableId).catch((error: unknown) => ({ ok: false, message: String(error) }));
      if (!res.ok && !/not found|closed/i.test(JSON.stringify(res))) {
        testInfo.annotations.push({ type: "cleanup", description: `close ${tableId}: ${JSON.stringify(res)}` });
      }
    }
    // Every test ends with every chip back in a wallet.
    if (players.length > 0) {
      const result = await chipAudit(players.map((p) => p.username));
      expect(result.onTables, `chips left on tables ${JSON.stringify(result)}`).toBe(0);
      expect(result.wallets, `chip conservation ${JSON.stringify(result)}`).toBe(result.granted);
    }
    for (const p of players) await p.context.close().catch(() => undefined);
  },
});

export { expect };
