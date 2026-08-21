/**
 * Static rarity tier per Blox Fruits fruit. Rarity is a fixed game property
 * (it never changes between stock resets), unlike the fruit list/price which
 * changes live -- so this is looked up locally instead of scraped each time.
 *
 * Sourced from the Blox Fruits Fandom wiki's rarity categories
 * (Category:Common/Uncommon/Rare/Legendary/Mythical), cross-referenced
 * against Category:Blox Fruits by Price to exclude non-fruit items.
 */
export const FRUIT_RARITY: Record<string, string> = {
  Blade: "Common",
  Bomb: "Common",
  Chop: "Common",
  Kilo: "Common",
  Rocket: "Common",
  Smoke: "Common",
  Spike: "Common",
  Spin: "Common",
  Spring: "Common",
  Dark: "Uncommon",
  Diamond: "Uncommon",
  Eagle: "Uncommon",
  Falcon: "Uncommon",
  Flame: "Uncommon",
  Ice: "Uncommon",
  Revive: "Uncommon",
  Sand: "Uncommon",
  Barrier: "Rare",
  Door: "Rare",
  Ghost: "Rare",
  Light: "Rare",
  Magma: "Rare",
  Rubber: "Rare",
  Blizzard: "Legendary",
  Buddha: "Legendary",
  Creation: "Legendary",
  Lightning: "Legendary",
  Love: "Legendary",
  Pain: "Legendary",
  Phoenix: "Legendary",
  Portal: "Legendary",
  Quake: "Legendary",
  Sound: "Legendary",
  Spider: "Legendary",
  Control: "Mythical",
  Dough: "Mythical",
  Dragon: "Mythical",
  Gas: "Mythical",
  Gravity: "Mythical",
  Kitsune: "Mythical",
  Leopard: "Mythical",
  Mammoth: "Mythical",
  Meme: "Mythical",
  Shadow: "Mythical",
  Soul: "Mythical",
  Spirit: "Mythical",
  "T-Rex": "Mythical",
  Tiger: "Mythical",
  Venom: "Mythical",
  Yeti: "Mythical",
};

export function lookupFruitRarity(name: string): string {
  return FRUIT_RARITY[name] ?? "Unknown";
}
