import { createServer } from "node:http";
import { createApp } from "./app.js";
import { closeAuthDatabase } from "./auth.js";
import { config } from "./config.js";
import { checkDatabaseReady, closeDatabase } from "./db/client.js";
import { logger } from "./logger.js";

await checkDatabaseReady();
const server = createServer(createApp());
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.listen(config.PORT, config.HOST, () => logger.info({ host: config.HOST, port: config.PORT }, "HTTP server listening"));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  const deadline = setTimeout(() => server.closeAllConnections(), 25_000);
  deadline.unref();
  server.close(async () => {
    clearTimeout(deadline);
    await Promise.allSettled([closeDatabase(), closeAuthDatabase()]);
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
