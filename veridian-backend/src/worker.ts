import { closeAuthDatabase } from "./auth.js";
import { closeDatabase, checkDatabaseReady } from "./db/client.js";
import { EmailWorker } from "./email/worker-service.js";
import { logger } from "./logger.js";

await checkDatabaseReady();
const worker = new EmailWorker();
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Stopping worker");
  worker.stop();
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await worker.run();
} finally {
  await Promise.allSettled([closeDatabase(), closeAuthDatabase()]);
}
