import app from "./app";
import { logger } from "./lib/logger";
import { startBloxFruitsStockBot } from "./services/bloxFruits/stockBot";

// ── Global crash guards ────────────────────────────────────────────────────
// These must be registered before any async work starts so that any exception
// or rejection that escapes its own try/catch does not silently kill the
// process. The bot should stay online through transient errors.
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — process continuing");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — process continuing");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // The bot starts whenever its required environment variables are present.
  // This keeps local development, Pterodactyl, and standard VPS deployments
  // on the same code path without relying on a platform-specific environment.
  startBloxFruitsStockBot();
});
