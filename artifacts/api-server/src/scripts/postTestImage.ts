/**
 * Posts a test stock image (using real DB cache) to the channel configured by
 * DISCORD_TEST_CHANNEL_ID to verify icons are rendering correctly.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp } from "node:fs/promises";
import { db, bloxFruitsStockStateTable } from "@workspace/db";
import { renderStockImage } from "../services/bloxFruits/renderStockImage";
import { computeNextResetUnixSeconds } from "../services/bloxFruits/scrapeStock";
import { postStockUpdate } from "../services/bloxFruits/discord";
import { getDiscordClient } from "../services/bloxFruits/discordClient";
import type { BloxFruitsDealer } from "../services/bloxFruits/types";

const TARGET_CHANNEL_ID = process.env["DISCORD_TEST_CHANNEL_ID"];
const BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!TARGET_CHANNEL_ID) {
  console.error("Missing DISCORD_TEST_CHANNEL_ID");
  process.exit(1);
}

// Ensure assets are alongside the bundle (for standalone preview builds)
const outDir = path.dirname(fileURLToPath(import.meta.url));
const srcAssets = path.resolve(outDir, "../../src/assets");
const dstAssets = path.resolve(outDir, "assets");
await cp(srcAssets, dstAssets, { recursive: true }).catch(() => {});

// Load cached stock from DB
const rows = await db.select().from(bloxFruitsStockStateTable);
if (rows.length === 0) {
  // Fallback to synthetic stock if DB is empty
  const dealers = [
    {
      dealer: "normal" as BloxFruitsDealer,
      label: "Normal Dealer",
      nextResetAt: computeNextResetUnixSeconds("normal"),
      items: [
        { name: "Flame", rarity: "Uncommon", price: "250,000 Beli" },
        { name: "Dark",  rarity: "Uncommon", price: "500,000 Beli" },
        { name: "Light", rarity: "Rare",     price: "650,000 Beli" },
        { name: "Dough", rarity: "Mythical", price: "2,800,000 Beli" },
      ],
    },
    {
      dealer: "mirage" as BloxFruitsDealer,
      label: "Mirage Dealer",
      nextResetAt: computeNextResetUnixSeconds("mirage"),
      items: [
        { name: "Rocket", rarity: "Common",    price: "5,000 Beli" },
        { name: "Magma",  rarity: "Rare",      price: "850,000 Beli" },
        { name: "Buddha", rarity: "Legendary", price: "1,500,000 Beli" },
        { name: "Dragon", rarity: "Mythical",  price: "3,500,000 Beli" },
      ],
    },
  ];
  console.log("No DB cache — using synthetic stock for test");
  for (const d of dealers) {
    await postStockUpdate(TARGET_CHANNEL_ID, BOT_TOKEN, d);
    console.log(`✓ Posted ${d.dealer} (synthetic)`);
  }
} else {
  const byDealer = new Map(rows.map(r => [r.dealer, r]));
  const order: BloxFruitsDealer[] = ["normal", "mirage"];
  for (const dealer of order) {
    const row = byDealer.get(dealer);
    if (!row) { console.warn(`No cache for ${dealer}`); continue; }
    const stock = {
      dealer,
      label: dealer,
      items: row.items,
      nextResetAt: computeNextResetUnixSeconds(dealer),
    };
    await postStockUpdate(TARGET_CHANNEL_ID, BOT_TOKEN, stock);
    console.log(`✓ Posted ${dealer} from DB cache — ${row.items.length} items`);
  }
}

const client = await getDiscordClient(BOT_TOKEN);
client.destroy();
console.log("Done.");
process.exit(0);
