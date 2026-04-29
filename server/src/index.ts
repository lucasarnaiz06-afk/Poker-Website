import { env } from "./config/env";
import { createApp } from "./http/app";

const app = createApp();

// Add "0.0.0.0" right after the port
app.listen(env.port, "0.0.0.0", () => {
  console.log(`Poker platform server listening on http://0.0.0.0:${env.port}`);
});