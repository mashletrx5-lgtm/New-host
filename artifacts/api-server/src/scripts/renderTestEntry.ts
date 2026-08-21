/**
 * Renders a test stock image using real DB data (or synthetic fallback)
 * and writes it to /tmp/stock-test.png for inspection.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, cp } from "node:fs/promises";
import { renderStockImage } from "../services/bloxFruits/renderStockImage";

// The built script lands in dist/render-test/; assets must be a sibling.
const outDir = path.dirname(fileURLToPath(import.meta.url));
const srcAssets = path.resolve(outDir, "../../src/assets");
const dstAssets = path.resolve(outDir, "assets");
await cp(srcAssets, dstAssets, { recursive: true }).catch(() => {});

// Synthetic stock with one of every rarity so we can see all icon states.
const dealers = [
  {
    dealer: "normal" as const,
    label: "Normal Dealer",
    nextResetAt: Math.floor(Date.now() / 1000) + 3600,
    items: [
      { name: "Flame",   rarity: "Uncommon",  price: "250,000 Beli" },
      { name: "Dark",    rarity: "Uncommon",  price: "500,000 Beli" },
      { name: "Light",   rarity: "Rare",      price: "650,000 Beli" },
      { name: "Dough",   rarity: "Mythical",  price: "2,800,000 Beli" },
    ],
  },
  {
    dealer: "mirage" as const,
    label: "Mirage Dealer",
    nextResetAt: Math.floor(Date.now() / 1000) + 1800,
    items: [
      { name: "Rocket",  rarity: "Common",    price: "5,000 Beli" },
      { name: "Magma",   rarity: "Rare",      price: "850,000 Beli" },
      { name: "Buddha",  rarity: "Legendary", price: "1,500,000 Beli" },
      { name: "Dragon",  rarity: "Mythical",  price: "3,500,000 Beli" },
    ],
  },
];

const buf = await renderStockImage(dealers);
const outPath = "/tmp/stock-test.png";
await writeFile(outPath, buf);
console.log(`Rendered → ${outPath} (${buf.length} bytes)`);
process.exit(0);
