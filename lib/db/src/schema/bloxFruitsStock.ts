import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per dealer ("normal" | "mirage"). Tracks the last stock we saw and
// posted, so the bot can detect a reset (contents changed) and never spam
// duplicate posts across restarts.
export const bloxFruitsStockStateTable = pgTable("blox_fruits_stock_state", {
  dealer: text("dealer").primaryKey(),
  signature: text("signature").notNull(),
  items: jsonb("items").notNull().$type<
    { name: string; rarity: string; price: string }[]
  >(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBloxFruitsStockStateSchema = createInsertSchema(
  bloxFruitsStockStateTable,
);
export type InsertBloxFruitsStockState = z.infer<
  typeof insertBloxFruitsStockStateSchema
>;
export type BloxFruitsStockState = typeof bloxFruitsStockStateTable.$inferSelect;
