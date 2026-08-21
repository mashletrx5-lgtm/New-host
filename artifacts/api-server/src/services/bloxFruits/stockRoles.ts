import type { Client, Collection, Guild, Role, Snowflake } from "discord.js";
import { logger } from "../../lib/logger";
import type { BloxFruitsDealer } from "./types";

export interface StockRoleIds {
  dealer: Record<BloxFruitsDealer, string>;
  fruit: Record<string, string>;
}

const DEALER_ROLE_NAMES: Record<BloxFruitsDealer, string> = {
  normal: "Normal Stock",
  mirage: "Mirage Stock",
};

// These are the fruit roles used in stock announcements. Keep the keys
// lowercase because stock scraper names are normalized that way at lookup time.
export const FRUIT_ROLE_NAMES: Record<string, string> = {
  quake: "Quake",
  love: "Love",
  spider: "Spider",
  sound: "Sound",
  phoenix: "Phoenix",
  creation: "Creation",
  blizzard: "Blizzard",
  buddha: "Buddha",
  portal: "Portal",
  shadow: "Shadow",
  spirit: "Spirit",
  mammoth: "Mammoth",
  gravity: "Gravity",
  "t-rex": "T-Rex",
  pain: "Pain",
  dough: "Dough",
  venom: "Venom",
  lightning: "Lightning",
  tiger: "Tiger",
  gas: "Gas",
  yeti: "Yeti",
  control: "Control",
  kitsune: "Kitsune",
};

// These roles are only repositioned. They are never created, renamed, deleted,
// or otherwise edited by the bot. The order here is their order from highest
// to lowest within the bottom block.
const BOTTOM_ROLE_NAMES = [
  "Normal Stock",
  "Mirage Stock",
  "Quake",
  "Love",
  "Spider",
  "Sound",
  "Phoenix",
  "Creation",
  "Blizzard",
  "Buddha",
  "Tiger",
  "Gas",
  "Yeti",
  "Control",
  "Kitsune",
  "Talkers",
  "Xenon",
] as const;

const roleIdsByClient = new WeakMap<Client, Promise<void>>();
const roleIdsByGuild = new WeakMap<Client, Map<string, StockRoleIds>>();

function sameRoleName(roleName: string, expectedName: string): boolean {
  return roleName.trim().toLowerCase() === expectedName.toLowerCase();
}

async function findOrCreateRole(
  guild: Guild,
  roles: Collection<Snowflake, Role>,
  name: string,
): Promise<string | undefined> {
  const existing = roles.find((role: { name: string }) =>
    sameRoleName(role.name, name),
  );
  if (existing) return existing.id;

  try {
    const created = await guild.roles.create({
      name,
      reason: "Blox Fruits stock bot role reconciliation",
    });
    logger.info(
      { guildId: guild.id, roleId: created.id, roleName: name },
      "Created missing Discord stock role",
    );
    return created.id;
  } catch (err) {
    logger.error(
      { err, guildId: guild.id, roleName: name },
      "Could not create missing Discord stock role — check Manage Roles permission",
    );
    return undefined;
  }
}

async function reconcileGuild(
  client: Client,
  guild: Guild,
): Promise<void> {
  try {
    const roles = await guild.roles.fetch();
    const dealer: Partial<Record<BloxFruitsDealer, string>> = {};
    const fruit: Record<string, string> = {};

    for (const [dealerKey, roleName] of Object.entries(DEALER_ROLE_NAMES) as [
      BloxFruitsDealer,
      string,
    ][]) {
      const roleId = await findOrCreateRole(guild, roles, roleName);
      if (roleId) dealer[dealerKey] = roleId;
    }

    for (const [fruitKey, roleName] of Object.entries(FRUIT_ROLE_NAMES)) {
      const roleId = await findOrCreateRole(guild, roles, roleName);
      if (roleId) fruit[fruitKey] = roleId;
    }

    if (dealer.normal && dealer.mirage) {
      roleIdsByGuild.get(client)!.set(guild.id, {
        dealer: {
          normal: dealer.normal,
          mirage: dealer.mirage,
        },
        fruit,
      });
    } else {
      logger.warn(
        { guildId: guild.id },
        "Discord stock role reconciliation incomplete — dealer roles are missing",
      );
    }

    // Fetch the final role state after any stock roles were created. Only
    // reposition existing roles; Talkers and Xenon are intentionally not
    // created if they are absent.
    const finalRoles = await guild.roles.fetch();
    const rolesToMove = BOTTOM_ROLE_NAMES.map((name) =>
      finalRoles.find((role) => sameRoleName(role.name, name)),
    )
      .filter((role): role is Role => Boolean(role))
      .filter((role) => !role.managed);

    const missingRoleNames = BOTTOM_ROLE_NAMES.filter(
      (name) =>
        !finalRoles.some((role) => sameRoleName(role.name, name)),
    );
    if (missingRoleNames.length > 0) {
      logger.warn(
        { guildId: guild.id, roleNames: missingRoleNames },
        "Some requested bottom roles were not found — leaving them unchanged",
      );
    }

    if (rolesToMove.length > 0) {
      try {
        // Discord position 0 is @everyone. Assign consecutive positions
        // immediately above it, with the user's listed order preserved from
        // highest to lowest inside the block.
        await guild.roles.setPositions(
          rolesToMove.map((role, index) => ({
            role: role.id,
            position: rolesToMove.length - index,
          })),
        );
        logger.info(
          {
            guildId: guild.id,
            roleNames: rolesToMove.map((role) => role.name),
            lowestPosition: 1,
          },
          "Moved requested Discord roles to the bottom of the role hierarchy",
        );
      } catch (err) {
        logger.error(
          { err, guildId: guild.id },
          "Could not move requested Discord roles — check Manage Roles permission and role hierarchy",
        );
      }
    }
  } catch (err) {
    logger.error(
      { err, guildId: guild.id },
      "Could not reconcile Discord stock roles for guild",
    );
  }
}

/**
 * Finds or creates the dealer and fruit roles in the guilds that own the
 * configured stock/command channels. The operation is cached per Discord
 * Client instance so concurrent stock posts do not create duplicate roles.
 */
export function ensureStockRoles(
  client: Client,
  targetChannelIds: string[],
): Promise<void> {
  const existing = roleIdsByClient.get(client);
  if (existing) return existing;

  const roleMap = new Map<string, StockRoleIds>();
  roleIdsByGuild.set(client, roleMap);

  const reconciliation = (async () => {
    const targetGuildIds = new Set<string>();

    for (const channelId of targetChannelIds) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && "guildId" in channel && typeof channel.guildId === "string") {
          targetGuildIds.add(channel.guildId);
        } else {
          logger.error(
            { channelId },
            "Configured Discord stock channel is not a server channel",
          );
        }
      } catch (err) {
        logger.error(
          { err, channelId },
          "Could not fetch configured Discord stock channel while reconciling roles",
        );
      }
    }

    for (const guildId of targetGuildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        logger.error(
          { guildId },
          "Configured Discord stock channel belongs to a guild unavailable to the bot",
        );
        continue;
      }
      await reconcileGuild(client, guild);
    }
  })();

  roleIdsByClient.set(client, reconciliation);
  return reconciliation;
}

export function getStockRoleIds(
  client: Client,
  guildId: string,
): StockRoleIds | undefined {
  return roleIdsByGuild.get(client)?.get(guildId);
}