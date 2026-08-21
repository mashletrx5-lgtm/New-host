import { db, bloxFruitsStockStateTable } from "@workspace/db";
import { AttachmentBuilder, type Client } from "discord.js";
import { logger } from "../../lib/logger";
import { getDiscordClient, onClientReady } from "./discordClient";
import { STOCK_REPLY_CAPTION, postStockUpdate } from "./discord";
import { computeNextResetUnixSeconds } from "./scrapeStock";
import { renderStockImage } from "./renderStockImage";
import type { BloxFruitsDealer, BloxFruitsDealerStock } from "./types";

const COMMAND = "!stock";
const REPOST_COMMAND = "!post.again";
const REPOST_ALLOWED_USER_ID_ENV = "DISCORD_REPOST_ALLOWED_USER_ID";

const DEALER_ORDER: BloxFruitsDealer[] = ["normal", "mirage"];

/**
 * Loads stock items from the DB cache and computes a fresh nextResetAt for
 * each dealer from the known fixed rotation schedule.
 *
 * No live scrape is needed: the reset schedule is deterministic (Normal every
 * 4 h, Mirage every 2 h, both UTC-aligned), so computeNextResetUnixSeconds
 * always gives a correct future timestamp.
 */
async function loadCachedStock(): Promise<BloxFruitsDealerStock[]> {
  const rows = await db.select().from(bloxFruitsStockStateTable);
  const byDealer = new Map(rows.map((row) => [row.dealer, row]));

  return DEALER_ORDER.filter((dealer) => byDealer.has(dealer)).map(
    (dealer) => {
      const row = byDealer.get(dealer)!;
      return {
        dealer,
        label: dealer,
        items: row.items,
        // Compute fresh at call time — no scrape needed, no drift from live
        // scrape latency, and always points to the correct future boundary.
        nextResetAt: computeNextResetUnixSeconds(dealer),
      };
    },
  );
}

function registerListener(
  client: Client,
  botToken: string,
  commandChannelId: string,
  channelIdByDealer: Record<BloxFruitsDealer, string>,
): void {
  client.on("messageCreate", (message) => {
    void (async () => {
      if (message.author.bot) return;
      if (message.channelId !== commandChannelId) return;

      const content = message.content.trim().toLowerCase();

      // ── !stock ──────────────────────────────────────────────────────────
      if (content === COMMAND) {
        const dealers = await loadCachedStock();

        if (dealers.length === 0) {
          await message.reply(
            "لا يوجد مخزون متوفر حالياً، حاول مرة أخرى بعد قليل.",
          );
          return;
        }

        const imageBuffer = await renderStockImage(dealers);
        const attachment = new AttachmentBuilder(imageBuffer, {
          name: "blox-fruits-stock.png",
        });

        await message.reply({
          content: STOCK_REPLY_CAPTION,
          files: [attachment],
        });

        logger.info(
          { requestedBy: message.author.id },
          "Replied to !stock command",
        );
      }

      // ── !post.again ──────────────────────────────────────────────────────
      if (content === REPOST_COMMAND) {
        const repostAllowedUserId =
          process.env[REPOST_ALLOWED_USER_ID_ENV]?.trim();
        if (!repostAllowedUserId || message.author.id !== repostAllowedUserId) {
          await message.reply("ليس لديك صلاحية استخدام هذا الأمر.");
          logger.warn(
            { userId: message.author.id },
            "Unauthorised !post.again attempt",
          );
          return;
        }

        // Items come from DB cache. nextResetAt is computed fresh from the
        // known schedule — no live scrape needed.
        const cachedDealers = await loadCachedStock();

        if (cachedDealers.length === 0) {
          await message.reply(
            "لا يوجد مخزون مخزّن حالياً، لا يمكن إعادة النشر.",
          );
          return;
        }

        for (const dealer of cachedDealers) {
          const channelId = channelIdByDealer[dealer.dealer];
          await postStockUpdate(channelId, botToken, dealer);
        }

        await message.reply("✅ تمت إعادة نشر المخزون الحالي.");

        logger.info(
          { requestedBy: message.author.id },
          "Reposted current stock via !post.again",
        );
      }
    })().catch((err) => {
      logger.error({ err }, "Failed to handle stock command");
    });
  });

  logger.info(
    { commandChannelId },
    "Registered !stock and !post.again command listeners",
  );
}

export function registerStockCommand(
  botToken: string,
  commandChannelId: string,
  channelIdByDealer: Record<BloxFruitsDealer, string>,
): void {
  // Register via onClientReady so the message listener is re-attached to every
  // fresh client instance — including after a self-healing reconnect following
  // a session invalidation. Using getDiscordClient().then() alone would only
  // register the listener on the initial client; after a reset the new client
  // would never receive !stock or !post.again commands.
  onClientReady((client) => {
    registerListener(client, botToken, commandChannelId, channelIdByDealer);
  });

  // Trigger the initial client creation. The clientReady event fires
  // onClientReady callbacks (including the one above), so this both starts
  // the login and registers the listener — all in one pass.
  getDiscordClient(botToken).catch((err) => {
    logger.error(
      { err },
      "Could not register stock commands — Discord Gateway connection failed",
    );
  });
}
