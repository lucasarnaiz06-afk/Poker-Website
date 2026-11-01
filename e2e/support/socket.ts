// A raw socket.io connection authenticated as a test player (their browser session cookie). Used for end-of-test
// cleanup of tables we created (the tests themselves close tables through the UI).
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "@poker-platform/shared/types";
import { io, type Socket } from "socket.io-client";
import type { Player } from "./users";

const SOCKET_URL = process.env.E2E_SOCKET_URL ?? "http://localhost:4000";
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export async function connectAs(player: Player) {
  const cookies = await player.context.cookies(ORIGIN);
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
    transports: ["websocket"],
    extraHeaders: { cookie, origin: ORIGIN },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (e) => reject(e));
  });
  const emit = <T = undefined>(event: string, payload: unknown) =>
    new Promise<Ack<T>>((resolve, reject) => {
      (socket.timeout(10_000) as unknown as { emit: (e: string, p: unknown, cb: (err: Error | null, r: Ack<T>) => void) => void }).emit(
        event,
        payload,
        (err, res) => (err ? reject(err) : resolve(res)),
      );
    });
  return { socket, emit, close: () => socket.close() };
}

/**
 * Host closes the table over the socket API (teardown only; tests use the "Close table" menu item). A hand in
 * progress is played out before the table closes, so every player checks or folds whenever it is their turn.
 */
export async function closeTableAs(host: Player, tableId: string, players: Player[] = []) {
  const clients = [await connectAs(host), ...(await Promise.all(players.filter((p) => p !== host).map(connectAs)))];
  try {
    const hostClient = clients[0]!;
    const closed = new Promise<void>((resolve) => {
      hostClient.socket.on("table:state", (view) => {
        if (view.status === "CLOSED") resolve();
      });
    });
    for (const client of clients) {
      client.socket.on("table:state", (view) => {
        const legal = view.viewer.legalActions;
        if (!view.hand || !legal) return;
        const type = legal.canCheck ? "check" : "fold";
        client.emit("table:action", { tableId, handId: view.hand.handId, type }).catch(() => undefined);
      });
    }
    const joined = await hostClient.emit("table:join", { tableId });
    if (!joined.ok) return joined;
    for (const client of clients.slice(1)) await client.emit("table:join", { tableId }).catch(() => undefined);
    const res = await hostClient.emit("table:close", { tableId });
    if (res.ok) await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 60_000))]);
    return res;
  } finally {
    for (const client of clients) client.close();
  }
}
