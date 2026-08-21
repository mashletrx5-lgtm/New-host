import { AttachmentBuilder } from "discord.js";
import { logger } from "../../lib/logger";
import { getDiscordClient } from "./discordClient";
import { renderStockImage } from "./renderStockImage";
import {
  ensureStockRoles,
  getStockRoleIds,
  type StockRoleIds,
} from "./stockRoles";
import type { BloxFruitsDealer, BloxFruitsDealerStock } from "./types";

const DEALER_LABELS: Record<BloxFruitsDealer, string> = {
  normal: "Normal Stock",
  mirage: "Mirage Stock",
};

const STOCK_REACTIONS_ENV = [
  "DISCORD_WIN_REACTION",
  "DISCORD_LOSE_REACTION",
] as const;

function getStockReactions(): string[] {
  return STOCK_REACTIONS_ENV.map((name) => process.env[name]?.trim()).filter(
    (reaction): reaction is string => Boolean(reaction),
  );
}

/**
 * Returns role mention strings for every fruit in stock that has a mapped role.
 * Fruits without a mapping are ignored.
 */
function fruitRoleMentions(
  items: { name: string }[],
  roleIds: StockRoleIds,
): string[] {
  return items
    .map((item) => {
      const roleId = roleIds.fruit[item.name.toLowerCase()];
      return roleId ? `<@&${roleId}>` : null;
    })
    .filter((mention): mention is string => mention !== null);
}

/**
 * Builds the message content string for a stock update post.
 *
 * Required format:
 *   Normal Stock / <@&ROLE>
 *   -# Resetting in: <t:TIMESTAMP:R>
 *   -# <fruit role mentions>   ← only when matching fruits are in stock
 *
 * TIMESTAMP is the absolute Unix timestamp (seconds) of the next scheduled
 * stock rotation, computed from the game's known 4h/2h UTC-aligned schedule.
 * Discord renders it as a live relative countdown ("in 3 hours 42 minutes").
 */
function buildStockMessage(
  stock: BloxFruitsDealerStock,
  roleIds: StockRoleIds,
): string {
  const dealerRole = `<@&${roleIds.dealer[stock.dealer]}>`;
  const label = DEALER_LABELS[stock.dealer];

  const line1 = `${label} / ${dealerRole}`;

  // nextResetAt is always set by the scraper/command handler via
  // computeNextResetUnixSeconds. The type allows null only for legacy
  // compatibility; in practice it is always present for live posts.
  const line2 =
    stock.nextResetAt != null
      ? `-# Resetting in: <t:${stock.nextResetAt}:R>`
      : `-# Resetting in: unknown`;

  const roleMentions = fruitRoleMentions(stock.items, roleIds);
  if (roleMentions.length === 0) {
    return `${line1}\n${line2}`;
  }

  const line3 = `-# ${roleMentions.join(" / ")}`;
  return `${line1}\n${line2}\n${line3}`;
}

export async function postStockUpdate(
  channelId: string,
  botToken: string,
  stock: BloxFruitsDealerStock,
): Promise<void> {
  const client = await getDiscordClient(botToken);
  await ensureStockRoles(client, [channelId]);
  const channel = await client.channels.fetch(channelId);

  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Channel ${channelId} is not a sendable text channel`);
  }

  if (!("guildId" in channel) || typeof channel.guildId !== "string") {
    throw new Error(`Channel ${channelId} does not belong to a Discord server`);
  }

  const roleIds = getStockRoleIds(client, channel.guildId);
  if (!roleIds) {
    throw new Error(
      `Stock roles are not available for Discord server ${channel.guildId}`,
    );
  }

  const imageBuffer = await renderStockImage([stock]);
  const attachment = new AttachmentBuilder(imageBuffer, {
    name: `blox-fruits-${stock.dealer}-stock.png`,
  });

  const content = buildStockMessage(stock, roleIds);

  const message = await channel.send({ content, files: [attachment] });

  // Reactions are supplementary. If Discord rejects one because an emoji was
  // deleted or the bot lacks access to it, the stock message itself remains a
  // successful post and the next poll must not repost it indefinitely.
  for (const reaction of getStockReactions()) {
    try {
      await message.react(reaction);
    } catch (err) {
      logger.warn(
        { err, reaction, messageId: message.id, channelId },
        "Could not add stock message reaction — keeping the stock post",
      );
    }
  }

  logger.info(
    { dealer: stock.dealer, channelId, items: stock.items.length },
    "Posted Blox Fruits stock update to Discord",
  );
}

export const STOCK_REPLY_CAPTION = "**Current Stock**";
