import { buildApp } from "./app.js";
import { config } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { ensureTradingIndexes } from "./trading/models.js";
import { startSettlementWorker } from "./trading/settlement.js";

const app = await buildApp();
let shuttingDown = false;
let stopSettlementWorker: () => void = () => {};

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, "Shutting down");
  stopSettlementWorker();

  const forceExit = setTimeout(() => {
    app.log.error("Graceful shutdown timed out");
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

/**
 * Nothing here fires a promise it doesn't await, so neither of these
 * should ever run. They exist because the alternative to catching them
 * is Node killing the process with the reason on stderr and nothing in
 * the structured log — a restart nobody can explain afterwards.
 *
 * A stray rejection doesn't mean the book is unsound (request failures
 * are handled by Fastify, and every money path is transactional), so it
 * is logged and serving continues. An uncaught exception can leave
 * state we can't reason about, so that one still ends the process and
 * lets the platform start a clean one.
 */
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "Unhandled promise rejection — still serving");
});
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "Uncaught exception — exiting for a clean restart");
  process.exit(1);
});

try {
  await connectDatabase();
  // unique-index guarantees (idempotency, one-shot settlement) must
  // exist before the first trade can race them
  await ensureTradingIndexes();
  await app.listen({ host: config.HOST, port: config.PORT });
  stopSettlementWorker = startSettlementWorker(app.log);
} catch (error) {
  app.log.fatal({ err: error }, "API failed to start");
  await disconnectDatabase();
  process.exit(1);
}
