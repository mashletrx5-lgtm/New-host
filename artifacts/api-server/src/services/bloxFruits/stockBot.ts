import { eq } from "drizzle-orm";
import { db, bloxFruitsStockStateTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { fetchBloxFruitsStock, stockSignature } from "./scrapeStock";
import { postStockUpdate } from "./discord";
import { registerStockCommand } from "./stockCommand";
import { ensureStockRoles } from "./stockRoles";
import { onClientReady } from "./discordClient";
import { startVoicePresence } from "./voicePresence";
import type { BloxFruitsDealer } from "./types";

const POLL_INTERVAL_MS = 60_000;

// ── Concurrency guard ────────────────────────────────────────────────────────
//
// Root cause of duplicate posts:
//   setInterval fires every 60 s regardless of whether the previous
//   checkForResets has finished. When stock changes, rendering + uploading
//   an image takes ~55 s, so the interval fires a second time while the
//   first invocation is still partway through its dealer loop.
//   Both calls read the DB before either one writes the new signature →
//   both see "signature changed" → both post.
//
// Fix:
//   Replace setInterval with recursive setTimeout: the next poll is only
//   scheduled AFTER the current one fully returns.  An isPolling flag adds
//   a second layer of protection so that even if scheduleNextPoll is somehow
//   called twice (e.g. a future code change), the second invocation is
//   silently dropped rather than running concurrently.
//
let isPolling = false;
let scheduledPoll: ReturnType<typeof setTimeout> | undefined;
let botStarted = false;

async function checkForResets(
  botToken: string,
  channelIdByDealer: Record<BloxFruitsDealer, string>,
): Promise<void> {
  let dealers;
  try {
    dealers = await fetchBloxFruitsStock();
  } catch (err) {
    logger.error({ err }, "Failed to fetch Blox Fruits stock — will retry next poll");
    return;
  }

  for (const dealer of dealers) {
    const signature = stockSignature(dealer.items);
    const channelId = channelIdByDealer[dealer.dealer];

    // DB read — wrap so a transient connection error skips this dealer
    // without crashing the process or the remaining dealers.
    let existing: { signature: string } | undefined;
    try {
      const [row] = await db
        .select()
        .from(bloxFruitsStockStateTable)
        .where(eq(bloxFruitsStockStateTable.dealer, dealer.dealer));
      existing = row;
    } catch (err) {
      logger.error(
        { err, dealer: dealer.dealer },
        "DB read failed during stock check — skipping dealer this poll",
      );
      continue;
    }

    if (existing && existing.signature === signature) {
      logger.debug(
        { dealer: dealer.dealer, signature },
        "Stock signature unchanged — skipping post",
      );
      continue;
    }

    try {
      await postStockUpdate(channelId, botToken, dealer);
    } catch (err) {
      logger.error(
        { err, dealer: dealer.dealer },
        "Failed to post stock update to Discord — will retry next poll",
      );
      // Do NOT save the signature — retry next poll.
      continue;
    }

    // DB write — if this fails the post already happened, so the next poll
    // will see the same "unsaved" signature and post again. That is preferable
    // to crashing the process.
    try {
      await db
        .insert(bloxFruitsStockStateTable)
        .values({ dealer: dealer.dealer, signature, items: dealer.items })
        .onConflictDoUpdate({
          target: bloxFruitsStockStateTable.dealer,
          set: { signature, items: dealer.items },
        });
    } catch (err) {
      logger.error(
        { err, dealer: dealer.dealer },
        "DB write failed after posting stock update — signature not saved, will retry next poll",
      );
    }
  }
}

/**
 * Runs one poll cycle then schedules the next one for POLL_INTERVAL_MS later.
 * Using recursive setTimeout (not setInterval) guarantees only one cycle runs
 * at a time: the next poll is only queued AFTER the current one finishes.
 *
 * The isPolling flag is a second-layer guard: if this function is ever invoked
 * concurrently (e.g. via a code change or an unexpected path), the duplicate
 * invocation is logged and dropped rather than racing against the active one.
 */
async function runPollThenScheduleNext(
  botToken: string,
  channelIdByDealer: Record<BloxFruitsDealer, string>,
): Promise<void> {
  if (isPolling) {
    logger.warn(
      "Poll cycle already in progress — duplicate invocation dropped. " +
        "This should not happen; investigate if it recurs.",
    );
    return;
  }

  isPolling = true;
  try {
    await checkForResets(botToken, channelIdByDealer);
  } finally {
    isPolling = false;
  }

  // Schedule the next poll only after this one has fully completed.
  // This is the key difference from setInterval: there is zero overlap
  // between consecutive poll cycles.
  scheduledPoll = setTimeout(
    () => void runPollThenScheduleNext(botToken, channelIdByDealer),
    POLL_INTERVAL_MS,
  );
}

export function startBloxFruitsStockBot(): void {
  const botToken = process.env["DISCORD_BOT_TOKEN"];
  const normalChannelId = process.env["DISCORD_NORMAL_STOCK_CHANNEL_ID"];
  const mirageChannelId = process.env["DISCORD_MIRAGE_STOCK_CHANNEL_ID"];
  const commandChannelId = process.env["DISCORD_STOCK_COMMAND_CHANNEL_ID"];

  if (!botToken || !normalChannelId || !mirageChannelId || !commandChannelId) {
    logger.warn(
      "Blox Fruits stock bot is disabled -- missing DISCORD_BOT_TOKEN, " +
        "DISCORD_NORMAL_STOCK_CHANNEL_ID, DISCORD_MIRAGE_STOCK_CHANNEL_ID, " +
        "or DISCORD_STOCK_COMMAND_CHANNEL_ID",
    );
    return;
  }

  if (botStarted) {
    logger.warn("startBloxFruitsStockBot() called more than once — ignoring duplicate call");
    return;
  }
  botStarted = true;

  const channelIdByDealer: Record<BloxFruitsDealer, string> = {
    normal: normalChannelId,
    mirage: mirageChannelId,
  };

  // Reconcile roles on every initial login and every self-healing reconnect,
  // even if the cached stock signature means no announcement is posted.
  // This guarantees a new server receives all required roles immediately.
  onClientReady((client) => {
    void ensureStockRoles(client, [
      normalChannelId,
      mirageChannelId,
      commandChannelId,
    ]).catch((err) => {
      logger.error({ err }, "Discord stock role reconciliation failed");
    });
  });

  startVoicePresence();
  registerStockCommand(botToken, commandChannelId, channelIdByDealer);

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS },
    "Starting Blox Fruits stock bot",
  );

  // Fire the first poll immediately. When it finishes it will schedule all
  // subsequent polls via recursive setTimeout.
  void runPollThenScheduleNext(botToken, channelIdByDealer);
}
