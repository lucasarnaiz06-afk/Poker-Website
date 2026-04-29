import { createServer } from "node:http";
import { env } from "./config/env";
import { createApp } from "./http/app";
import { createSocketServer } from "./realtime/socket-server";

const app = createApp();
const httpServer = createServer(app);

createSocketServer(httpServer);

// Add "0.0.0.0" right after the port
httpServer.listen(env.port, "0.0.0.0", () => {
  console.log(`Poker platform server listening on http://0.0.0.0:${env.port}`);
});
