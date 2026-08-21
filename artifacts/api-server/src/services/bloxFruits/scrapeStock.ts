import * as cheerio from "cheerio";
import { logger } from "../../lib/logger";
import { lookupFruitRarity } from "./fruitRarity";
import type { BloxFruitsDealer, BloxFruitsDealerStock } from "./types";

const STOCK_PAGE_URL_ENV = "STOCK_SOURCE_URL";

const DEALER_LABELS: Record<"normal" | "mirage", string> = {
  normal: "Normal Dealer",
  mirage: "Mirage Dealer",
};

/**
 * Blox Fruits has no official public stock API -- the dealer inventory only
 * exists inside the live Roblox game. We track it by scraping a community
 * stock-tracker page (fruityblox.com) that server-renders its stock list.
 *
 * NOTE: an earlier revision scraped bloxfruitstradingcalculator.net, which
 * turned out to be a static WordPress page frozen since 2026-04-22 (its
 * `stock` items never change) -- it looked live but was actually fake demo
 * content. If posts stop appearing or items look wrong again, verify the
 * source page's `cache-control`/`modified` metadata before assuming a bug in
 * this code -- confirm the *source* is actually live before debugging further.
 *
 * Rarity is not scraped from this page (it labels fruits by "type" --
 * Natural/Elemental/Beast -- not by rarity tier); it's looked up from the
 * static `fruitRarity` map instead, since rarity never changes per fruit.
 *
 * Reset timestamps:
 * fruityblox.com embeds no server-side reset timestamp -- the countdown is
 * rendered client-side in a JavaScript bundle that calculates it from the
 * game's fixed rotation schedule.  We replicate that calculation directly:
 * Normal resets every 4 hours at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC.
 * Mirage resets every 2 hours at every even UTC hour (00:00, 02:00, 04:00 …).
 * Both schedules are anchored to the Unix epoch (which is a round UTC midnight),
 * so the next reset is simply the next multiple of the interval from now.
 * This was verified against bot post timestamps in deployment logs:
 *   normal post at 12:05:52 UTC → preceded by the 12:00 UTC boundary ✓
 *   previous normal post at 09:29:40 UTC → preceded by the 08:00 UTC boundary ✓
 */

/** Interval in seconds for each dealer's stock rotation. */
const RESET_INTERVAL_SECONDS: Record<BloxFruitsDealer, number> = {
  normal: 4 * 3600,  // 14400 s — rotates every 4 hours at UTC multiples of 4
  mirage: 2 * 3600,  // 7200 s  — rotates every 2 hours at every even UTC hour
};

/**
 * Returns the absolute Unix timestamp (seconds) of the next scheduled stock
 * rotation for the given dealer, calculated from the current UTC time.
 *
 * Uses ceiling division anchored to the Unix epoch:
 *   next = ceil(now / interval) * interval
 * with an edge-case guard: if now falls exactly on a boundary (i.e. the
 * rotation is happening right now), advance to the NEXT boundary so the
 * Discord <t:...:R> timestamp is always in the future.
 */
export function computeNextResetUnixSeconds(dealer: BloxFruitsDealer): number {
  const interval = RESET_INTERVAL_SECONDS[dealer];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const elapsed = nowSeconds % interval;          // seconds since last reset
  const remaining = elapsed === 0               // exactly on a boundary?
    ? interval                                  //   → full interval ahead
    : interval - elapsed;                       //   → time until next boundary
  return nowSeconds + remaining;
}

// Maximum time (ms) to wait for the stock page to respond. Without a timeout
// Node's built-in fetch (undici) waits up to 300 s for the response body. A
// hung fruityblox.com request would freeze the entire poll loop — no stock
// checks happen for 5 minutes. 15 s is generous for a simple HTML page.
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchBloxFruitsStock(): Promise<BloxFruitsDealerStock[]> {
  const stockPageUrl = process.env[STOCK_PAGE_URL_ENV]?.trim();
  if (!stockPageUrl) {
    throw new Error(`${STOCK_PAGE_URL_ENV} must be configured`);
  }

  let parsedStockPageUrl: URL;
  try {
    parsedStockPageUrl = new URL(stockPageUrl);
  } catch {
    throw new Error(`${STOCK_PAGE_URL_ENV} must be a valid absolute URL`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(parsedStockPageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BloxFruitsStockBot/1.0)" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Stock page fetch timed out after ${FETCH_TIMEOUT_MS} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(
      `Stock source responded with ${res.status} ${res.statusText}`,
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const dealers: BloxFruitsDealerStock[] = [];

  $("section").each((_i, section) => {
    const $section = $(section);
    const heading = $section.find("h2").first().text().trim();
    if (!/^normal$/i.test(heading) && !/^mirage$/i.test(heading)) return;

    const dealer: "normal" | "mirage" = /mirage/i.test(heading)
      ? "mirage"
      : "normal";

    const items = $section
      .find('a[href^="/items/"]')
      .map((_j, el) => {
        const $el = $(el);
        const name = $el.find("h3").first().text().trim();
        const beli = $el.find(".text-green-400").first().text().trim();
        return {
          name,
          rarity: lookupFruitRarity(name),
          price: beli ? `${beli} Beli` : "",
        };
      })
      .get()
      .filter((item) => item.name.length > 0);

    if (items.length > 0) {
      dealers.push({
        dealer,
        label: DEALER_LABELS[dealer],
        items,
        nextResetAt: computeNextResetUnixSeconds(dealer),
      });
    }
  });

  if (dealers.length === 0) {
    logger.warn(
      { htmlLength: html.length },
      "Blox Fruits stock scrape returned no dealers -- source markup may have changed",
    );
  }

  return dealers;
}

export function stockSignature(items: { name: string; rarity: string }[]): string {
  return items
    .map((item) => `${item.name}:${item.rarity}`)
    .sort()
    .join("|");
}
