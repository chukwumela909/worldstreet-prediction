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
