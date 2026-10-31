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

/** Host closes the table over the socket API (teardown only; tests use the "Close table" menu item). */
export async function closeTableAs(host: Player, tableId: string) {
  const client = await connectAs(host);
  try {
    const joined = await client.emit("table:join", { tableId });
    if (!joined.ok) return joined;
    return await client.emit("table:close", { tableId });
  } finally {
    client.close();
  }
}
