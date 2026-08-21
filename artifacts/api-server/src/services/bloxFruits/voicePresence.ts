import {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import { logger } from "../../lib/logger";
import { onClientReady } from "./discordClient";

const REJOIN_DELAY_MS = 5_000;
const VOICE_CHANNEL_ENV = "DISCORD_VOICE_CHANNEL_ID";

let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let configuredChannelId: string | undefined;
let activeConnection: VoiceConnection | undefined;

function scheduleRejoin(client: Client): void {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void joinConfiguredVoiceChannel(client);
  }, REJOIN_DELAY_MS);
}

async function joinConfiguredVoiceChannel(client: Client): Promise<void> {
  const channelId = configuredChannelId;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isVoiceBased() || !channel.guild) {
      logger.error(
        { channelId },
        "Configured Discord voice channel is not a guild voice channel",
      );
      return;
    }

    const existingConnection = getVoiceConnection(channel.guild.id);
    if (existingConnection) {
      if (activeConnection === existingConnection) {
        activeConnection = undefined;
      }
      existingConnection.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });
    activeConnection = connection;

    connection.on(VoiceConnectionStatus.Ready, () => {
      if (activeConnection !== connection) return;
      logger.info(
        { channelId: channel.id, guildId: channel.guild.id },
        "Discord bot joined configured voice channel",
      );
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      if (activeConnection !== connection) return;
      logger.warn(
        { channelId: channel.id, guildId: channel.guild.id },
        "Discord bot left the configured voice channel — scheduling rejoin",
      );
      activeConnection = undefined;
      connection.destroy();
      scheduleRejoin(client);
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (activeConnection !== connection) return;
      activeConnection = undefined;
      scheduleRejoin(client);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    activeConnection = undefined;
    logger.error(
      { err, channelId },
      "Could not join configured Discord voice channel — scheduling rejoin",
    );
    scheduleRejoin(client);
  }
}

/**
 * Keeps the bot in the voice channel configured by DISCORD_VOICE_CHANNEL_ID.
 * The callback is registered through onClientReady so a fresh Gateway client
 * after session invalidation also gets a fresh voice connection.
 */
export function startVoicePresence(): void {
  configuredChannelId = process.env[VOICE_CHANNEL_ENV]?.trim() || undefined;

  if (!configuredChannelId) {
    logger.info(
      `${VOICE_CHANNEL_ENV} is not configured — voice presence is disabled`,
    );
    return;
  }

  if (started) return;
  started = true;

  onClientReady((client) => {
    void joinConfiguredVoiceChannel(client);
  });

  logger.info(
    { channelId: configuredChannelId },
    "Discord voice presence enabled",
  );
}