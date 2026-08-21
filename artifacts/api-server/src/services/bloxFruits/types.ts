export interface BloxFruitsStockItem {
  name: string;
  rarity: string;
  price: string;
}

export type BloxFruitsDealer = "normal" | "mirage";

export interface BloxFruitsDealerStock {
  dealer: BloxFruitsDealer;
  label: string;
  items: BloxFruitsStockItem[];
  /**
   * Absolute Unix timestamp (seconds) of the next scheduled stock rotation for
   * this dealer.  Use directly in Discord's <t:TIMESTAMP:R> format.
   * null when the reset time is unknown.
   */
  nextResetAt: number | null;
}
