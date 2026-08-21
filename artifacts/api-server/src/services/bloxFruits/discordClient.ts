import { ActivityType, Client, GatewayIntentBits, Partials } from "discord.js";
import { logger } from "../../lib/logger";

let client: Client | undefined;
let readyPromise: Promise<Client> | undefined;
let storedToken: string | undefined;

// Callbacks fired every time a client becomes ready — including after a
// reconnect that replaces the old (invalidated) client. Callers register
// here instead of calling getDiscordClient().then(...) directly so that
// their setup (e.g. message listeners) is automatically re-applied to the
// new client after a session reset.
const reconnectCallbacks: Array<(client: Client) => void> = [];

/**
 * Register a callback that is invoked every time a Discord client becomes
 * ready. This fires on the initial login AND after every subsequent
 * self-healing reconnect.
 *
 * Use this instead of `getDiscordClient().then(cb)` whenever the callback
 * attaches event listeners to the client — those listeners live on the
 * client instance and must be re-attached after an invalidation.
 */
export function onClientReady(cb: (client: Client) => void): void {
  reconnectCallbacks.push(cb);
}

// ── Self-healing reconnect ─────────────────────────────────────────────────
//
// Called when the "invalidated" event fires. discord.js cannot recover
// from a session invalidation on its own — we must destroy the dead client,
// clear the cached singleton, and create a fresh one.
//
// Exponential backoff (30 s → 60 s → 120 s → … → 300 s max) avoids
// hammering Discord during a sustained outage or when the cause is a
// misconfiguration (e.g. revoked token, disallowed intents).
//
let reconnectAttempt = 0;

function scheduleReconnect(): void {
  // Destroy the dead client and clear the cached singleton so the next
  // getDiscordClient() call starts fresh.
  if (client) {
    try {
      client.destroy();
    } catch {
      // Ignore — the client is already in an unusable state.
    }
  }
  client = undefined;
  readyPromise = undefined;

  const baseDelay = 30_000;
  const maxDelay = 300_000;
  const delay = Math.min(baseDelay * 2 ** reconnectAttempt, maxDelay);
  reconnectAttempt += 1;

  logger.warn(
    { attempt: reconnectAttempt, delayMs: delay },
    "Discord session invalidated — scheduling self-healing reconnect",
  );

  setTimeout(() => {
    if (!storedToken) {
      logger.error(
        "Cannot reconnect — bot token is missing. Process will wait for the next invalidated event.",
      );
      return;
    }

    // getDiscordClient() creates a fresh client and resolves the ready
    // promise. The clientReady handler inside fires all reconnectCallbacks,
    // which re-attaches message listeners etc. to the new client.
    getDiscordClient(storedToken).catch((err: unknown) => {
      logger.error({ err }, "Discord reconnect attempt failed — will retry");
      scheduleReconnect();
    });
  }, delay);
}

/**
 * Lazily creates and logs in a single shared discord.js client for the whole
 * Blox Fruits bot feature (both posting stock updates and listening for the
 * !stock command need a live Gateway connection).
 *
 * Resilience design:
 * - Persistent `on("shardError")` and `on("error")` listeners are attached
 *   immediately so any network blip during normal operation is logged instead
 *   of becoming an unhandled EventEmitter error that crashes the process.
 * - discord.js v14 reconnects the shard automatically after a shardError; we
 *   must not destroy or re-login the client — just let it recover.
 * - Session invalidation (a state discord.js cannot recover from) is handled
 *   by destroying the dead client and creating a new one via scheduleReconnect.
 *   No process.exit is needed — the bot heals itself in-process.
 * - Login failures (e.g. invalid token) still reject the promise via the
 *   `client.login().catch(reject)` path so the caller can log and skip.
 *
 * Note: reading message content for the !stock command requires the
 * "Message Content Intent" to be enabled for this bot in the Discord
 * Developer Portal (Bot tab -> Privileged Gateway Intents), otherwise
 * incoming message content arrives empty.
 */
export function getDiscordClient(botToken: string): Promise<Client> {
  storedToken = botToken;

  if (readyPromise) {
    return readyPromise;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
  });

  // ── Persistent error handlers ──────────────────────────────────────────
  // These must be attached BEFORE login() so they are active for the entire
  // lifetime of the client, not just during the login phase.
  //
  // discord.js emits "shardError" for WebSocket-level errors throughout the
  // connection's lifetime. Without a listener this becomes an unhandled
  // EventEmitter error and crashes the Node.js process.
  // discord.js will automatically attempt to reconnect the shard; we just
  // log and let it do so.
  client.on("shardError", (err) => {
    logger.error(
      { err },
      "Discord Gateway shard error — discord.js will auto-reconnect. " +
        "If this says 'disallowed intents', enable MESSAGE CONTENT INTENT " +
        "in the Discord Developer Portal (Bot tab → Privileged Gateway Intents).",
    );
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  // Log every successful reconnection so we have an audit trail.
  client.on("shardReady", (shardId) => {
    logger.info({ shardId }, "Discord Gateway shard ready / reconnected");
  });

  // ── Shard disconnection ────────────────────────────────────────────────
  // Log every disconnect with its close code so we have an audit trail.
  // For resumable codes discord.js reconnects automatically. For non-resumable
  // codes (e.g. 4014 Disallowed Intents) discord.js fires "invalidated" next,
  // which is handled below.
  client.on("shardDisconnect", (event, shardId) => {
    logger.warn(
      { shardId, code: event.code, wasClean: event.wasClean },
      "Discord shard disconnected — discord.js will attempt to resume/reconnect. " +
        "Non-resumable codes will also emit 'invalidated' and trigger a self-healing reconnect.",
    );
  });

  // ── Session invalidation ───────────────────────────────────────────────
  // The "invalidated" event fires when Discord's servers permanently invalidate
  // the bot's Gateway session. This happens after too many failed reconnection
  // attempts, a server-side forced reset, or a non-resumable close code (e.g.
  // 4014 Disallowed Intents). discord.js explicitly cannot recover from this
  // state — the documentation says "you will need to create a new Client and
  // login again."
  //
  // Previous design: call process.exit(1) and rely on the deployment platform
  // to restart the process. This worked on vm (always-running) deployments but
  // was fatal on hosted instances: process.exit terminates the process
  // permanently instead of allowing the client to reconnect.
  //
  // Current design: destroy the dead client in-process, clear the cached
  // singleton, and schedule a fresh login via scheduleReconnect(). This heals
  // the bot without any process exit — and therefore without any dependency on
  // the deployment type.
  client.on("invalidated", () => {
    logger.error(
      "Discord session invalidated — discord.js cannot reconnect from this " +
        "state. Destroying the dead client and scheduling a self-healing " +
        "reconnect (no process exit required).",
    );
    scheduleReconnect();
  });

  // ── Login + ready promise ───────────────────────────────────────────────
  readyPromise = new Promise((resolve, reject) => {
    client!.once("clientReady", (readyClient) => {
      // Reset backoff counter on a successful login.
      reconnectAttempt = 0;

      readyClient.user.setPresence({
        activities: [
          {
            name: "FR9 STORE",
            type: ActivityType.Competing,
          },
        ],
        status: "online",
      });
      logger.info(
        { user: readyClient.user.tag },
        "Discord bot connected to the Gateway",
      );
      resolve(readyClient);

      // Fire all registered callbacks. This covers both the initial login and
      // every subsequent reconnect — callers that registered via onClientReady
      // will have their setup (message listeners, etc.) re-applied to the new
      // client instance automatically.
      for (const cb of reconnectCallbacks) {
        try {
          cb(readyClient);
        } catch (err) {
          logger.error({ err }, "onClientReady callback threw — continuing with remaining callbacks");
        }
      }
    });

    // login() only rejects on hard failures (invalid token, network
    // unreachable at startup). Runtime errors are handled by shardError above.
    client!.login(botToken).catch((err: unknown) => {
      logger.error({ err }, "Discord login failed");
      reject(err as Error);
    });
  });

  readyPromise.catch(() => {
    // Reset so the next call can retry (e.g. after fixing a bad token and
    // restarting). Prevents the rejection being reported as unhandled.
    readyPromise = undefined;
  });

  return readyPromise;
}
