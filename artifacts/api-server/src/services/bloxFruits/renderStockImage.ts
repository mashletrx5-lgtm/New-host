import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { logger } from "../../lib/logger";
import type { BloxFruitsDealer, BloxFruitsDealerStock } from "./types";

// This module is always executed as part of the bundled dist/index.mjs (the
// dev script runs `build` before `start`), where esbuild inlines this file's
// code alongside the entry point. The build step copies `src/assets` to
// `dist/assets`, a sibling of the bundle, so resolve against that.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(currentDir, "assets");
const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
const FRUITS_DIR = path.join(ASSETS_DIR, "fruits");

const FONT_FAMILY_HEADING = "Poppins Bold";
const FONT_FAMILY_SUBHEADING = "Poppins SemiBold";
const FONT_FAMILY_BODY = "Poppins Regular";
const FONT_FAMILY_ARABIC = "Amiri Bold";

const IRAQ_TIME_ZONE = "Asia/Baghdad";

function formatIraqTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IRAQ_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `Iraq - ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

let fontsRegistered = false;
function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(
    path.join(FONTS_DIR, "Poppins-Bold.ttf"),
    FONT_FAMILY_HEADING,
  );
  GlobalFonts.registerFromPath(
    path.join(FONTS_DIR, "Poppins-SemiBold.ttf"),
    FONT_FAMILY_SUBHEADING,
  );
  GlobalFonts.registerFromPath(
    path.join(FONTS_DIR, "Poppins-Regular.ttf"),
    FONT_FAMILY_BODY,
  );
  GlobalFonts.registerFromPath(
    path.join(FONTS_DIR, "Amiri-Bold.ttf"),
    FONT_FAMILY_ARABIC,
  );
  fontsRegistered = true;
}

let fruitManifest: Record<string, string> | null = null;
async function loadFruitManifest(): Promise<Record<string, string>> {
  if (fruitManifest) return fruitManifest;
  try {
    const raw = await fs.readFile(
      path.join(FRUITS_DIR, "manifest.json"),
      "utf-8",
    );
    fruitManifest = JSON.parse(raw) as Record<string, string>;
  } catch (err) {
    logger.warn({ err }, "Failed to load Blox Fruits image manifest");
    fruitManifest = {};
  }
  return fruitManifest;
}

const fruitImageCache = new Map<string, Image | null>();
async function loadFruitImage(name: string): Promise<Image | null> {
  if (fruitImageCache.has(name)) return fruitImageCache.get(name)!;

  const manifest = await loadFruitManifest();
  const fileName = manifest[name];
  if (!fileName) {
    fruitImageCache.set(name, null);
    return null;
  }

  try {
    const image = await loadImage(path.join(FRUITS_DIR, fileName));
    fruitImageCache.set(name, image);
    return image;
  } catch (err) {
    logger.warn({ err, name }, "Failed to load fruit image");
    fruitImageCache.set(name, null);
    return null;
  }
}

const DEALER_THEME: Record<
  BloxFruitsDealer,
  { accent: string; accentSoft: string; english: string; arabic: string }
> = {
  normal: {
    accent: "#f5b942",
    accentSoft: "rgba(245, 185, 66, 0.16)",
    english: "Normal Dealer",
    arabic: "الشوب العادي",
  },
  mirage: {
    accent: "#8e6bf0",
    accentSoft: "rgba(142, 107, 240, 0.16)",
    english: "Mirage Dealer",
    arabic: "شوب ميراج",
  },
};

const RARITY_COLORS: Record<string, string> = {
  common: "#9aa4b2",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  legendary: "#f97316",
  mythical: "#f43f5e",
};

function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity.trim().toLowerCase()] ?? "#9aa4b2";
}

function drawRoundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const CANVAS_WIDTH = 1080;
const PADDING = 48;
const COLUMNS = 3;
const CARD_GAP = 20;
const CARD_HEIGHT = 128;
const HEADER_HEIGHT = 96;
const SECTION_GAP = 36;
const FOOTER_HEIGHT = 110;
const CARD_WIDTH =
  (CANVAS_WIDTH - PADDING * 2 - CARD_GAP * (COLUMNS - 1)) / COLUMNS;

function sectionHeight(itemCount: number): number {
  const rows = Math.max(1, Math.ceil(itemCount / COLUMNS));
  return HEADER_HEIGHT + rows * CARD_HEIGHT + (rows - 1) * CARD_GAP;
}

/**
 * Renders one or more dealers' current stock as a single branded PNG image,
 * complete with fruit artwork, rarity-coded cards, and a semi-transparent
 * "Made by fr9" watermark.
 */
export async function renderStockImage(
  dealers: BloxFruitsDealerStock[],
): Promise<Buffer> {
  ensureFontsRegistered();

  const totalHeight =
    PADDING * 2 +
    dealers.reduce((sum, d) => sum + sectionHeight(d.items.length), 0) +
    SECTION_GAP * Math.max(0, dealers.length - 1) +
    FOOTER_HEIGHT;

  const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
  const ctx = canvas.getContext("2d");

  // Background: deep ocean gradient with a subtle vignette, matching the
  // Blox Fruits pirate/sea theme.
  const bgGradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, totalHeight);
  bgGradient.addColorStop(0, "#0a1a2f");
  bgGradient.addColorStop(0.55, "#0e2439");
  bgGradient.addColorStop(1, "#0a1a2f");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

  const vignette = ctx.createRadialGradient(
    CANVAS_WIDTH / 2,
    totalHeight * 0.35,
    totalHeight * 0.1,
    CANVAS_WIDTH / 2,
    totalHeight * 0.35,
    totalHeight * 0.9,
  );
  vignette.addColorStop(0, "rgba(20, 60, 90, 0.25)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

  let cursorY = PADDING;

  for (const dealer of dealers) {
    const theme = DEALER_THEME[dealer.dealer];

    // Header bar
    drawRoundedRect(
      ctx,
      PADDING,
      cursorY,
      CANVAS_WIDTH - PADDING * 2,
      HEADER_HEIGHT - 16,
      18,
    );
    ctx.fillStyle = theme.accentSoft;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.accent;
    ctx.stroke();

    const headerTextY = cursorY + (HEADER_HEIGHT - 16) / 2;

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = theme.accent;
    ctx.font = `30px "${FONT_FAMILY_HEADING}"`;
    ctx.fillText(theme.english, PADDING + 28, headerTextY);

    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#e8edf5";
    ctx.font = `26px "${FONT_FAMILY_ARABIC}"`;
    ctx.fillText(
      theme.arabic,
      CANVAS_WIDTH - PADDING - 28,
      headerTextY,
    );
    ctx.direction = "ltr";

    cursorY += HEADER_HEIGHT;

    // Item cards
    for (let i = 0; i < dealer.items.length; i++) {
      const item = dealer.items[i]!;
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const cardX = PADDING + col * (CARD_WIDTH + CARD_GAP);
      const cardY = cursorY + row * (CARD_HEIGHT + CARD_GAP);
      const color = rarityColor(item.rarity);

      drawRoundedRect(ctx, cardX, cardY, CARD_WIDTH, CARD_HEIGHT, 16);
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `${color}99`;
      ctx.stroke();

      // Fruit icon
      const iconSize = 76;
      const iconX = cardX + 16;
      const iconY = cardY + (CARD_HEIGHT - iconSize) / 2;
      const image = await loadFruitImage(item.name);
      if (image) {
        ctx.drawImage(image, iconX, iconY, iconSize, iconSize);
      } else {
        drawRoundedRect(ctx, iconX, iconY, iconSize, iconSize, 12);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fill();
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = "center";
        ctx.direction = "ltr";
        ctx.font = `30px "${FONT_FAMILY_HEADING}"`;
        ctx.fillText(
          item.name.charAt(0).toUpperCase(),
          iconX + iconSize / 2,
          iconY + iconSize / 2 + 2,
        );
      }

      const textX = iconX + iconSize + 16;
      const textMaxWidth = cardX + CARD_WIDTH - textX - 12;

      ctx.direction = "ltr";
      ctx.textAlign = "left";
      ctx.fillStyle = "#f5f7fa";
      ctx.font = `21px "${FONT_FAMILY_SUBHEADING}"`;
      ctx.fillText(item.name, textX, cardY + 34, textMaxWidth);

      // Rarity pill
      ctx.font = `12px "${FONT_FAMILY_SUBHEADING}"`;
      const rarityLabel = item.rarity.toUpperCase();
      const rarityMetrics = ctx.measureText(rarityLabel);
      const pillPaddingX = 10;
      const pillWidth = rarityMetrics.width + pillPaddingX * 2;
      const pillHeight = 22;
      const pillX = textX;
      const pillY = cardY + 48;
      drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
      ctx.fillStyle = `${color}33`;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(rarityLabel, pillX + pillPaddingX, pillY + pillHeight / 2 + 1);

      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#9fd8c2";
      ctx.font = `17px "${FONT_FAMILY_BODY}"`;
      ctx.fillText(item.price, textX, cardY + 100, textMaxWidth);
    }

    cursorY += sectionHeight(dealer.items.length) - HEADER_HEIGHT + SECTION_GAP;
  }

  // Footer divider + branding
  const footerY = totalHeight - FOOTER_HEIGHT;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, footerY + 24);
  ctx.lineTo(CANVAS_WIDTH - PADDING, footerY + 24);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(232, 237, 245, 0.7)";
  ctx.font = `16px "${FONT_FAMILY_BODY}"`;
  ctx.fillText(
    "Blox Fruits Stock Tracker",
    CANVAS_WIDTH / 2,
    footerY + 54,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(159, 216, 194, 0.6)";
  ctx.font = `13px "${FONT_FAMILY_BODY}"`;
  ctx.fillText(
    formatIraqTimestamp(new Date()),
    CANVAS_WIDTH - PADDING,
    totalHeight - 20,
  );
  ctx.textAlign = "center";

  // Semi-transparent watermark at the very bottom of the image.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#ffffff";
  ctx.font = `24px "${FONT_FAMILY_HEADING}"`;
  ctx.fillText("Made by fr9", CANVAS_WIDTH / 2, totalHeight - 20);
  ctx.globalAlpha = 1;

  return canvas.toBuffer("image/png");
}
