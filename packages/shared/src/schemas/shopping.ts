import { z } from 'zod';
import { RECURRENCE_PATTERNS } from '../recurrence.js';

// Shopping module (migration 0044). Persistent, cycling shopping lists:
// a list is a store/section (Household, Costco, Kroger…) and an item is
// a thing you buy there repeatedly. Semantics are INVERTED from tasks —
// `needed` checked means "buy this", and purchasing clears the flag and
// appends a row to the purchase ledger. Items persist forever; they
// cycle between stocked and needed rather than completing.
//
// The ledger (shopping_purchases) is deliberately its own table so a
// future finance module (bank transactions, receipts) can FK to it.

const RecurrenceRuleSchema = z.enum(RECURRENCE_PATTERNS);

export const ShoppingListSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  position: z.number().int(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ShoppingItemSchema = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  name: z.string().min(1),
  note: z.string().nullable().optional(),
  position: z.number().int(),
  needed: z.boolean(),
  needed_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Optional auto-reflag cadence, anchored to last_purchased_at (see
  // isDueAgain in recurrence.ts). Most items have no rule — the user
  // flags them manually when supplies run low.
  recurrence_rule: RecurrenceRuleSchema.nullable().optional(),
  last_purchased_at: z.string().datetime({ offset: true }).nullable().optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ShoppingPurchaseSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  purchased_at: z.string().datetime({ offset: true }),
  price_cents: z.number().int().nonnegative().nullable().optional(),
  note: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

export const CreateShoppingListSchema = z.object({
  name: z.string().trim().min(1),
  position: z.number().int().optional(),
});

export const UpdateShoppingListSchema = z.object({
  name: z.string().trim().min(1).optional(),
  position: z.number().int().optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const CreateShoppingItemSchema = z.object({
  list_id: z.string().uuid(),
  name: z.string().trim().min(1),
  note: z.string().nullable().optional(),
  recurrence_rule: RecurrenceRuleSchema.nullable().optional(),
  position: z.number().int().optional(),
  // Allow add-and-flag in one call ("we're out of this, and it's not on
  // the list yet").
  needed: z.boolean().optional(),
});

// Metadata only — the needed flag moves through the flag/purchase
// endpoints so the ledger and recurrence anchor stay consistent.
export const UpdateShoppingItemSchema = z.object({
  list_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).optional(),
  note: z.string().nullable().optional(),
  recurrence_rule: RecurrenceRuleSchema.nullable().optional(),
  position: z.number().int().optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const FlagShoppingItemSchema = z.object({
  needed: z.boolean(),
});

export const PurchaseShoppingItemSchema = z.object({
  purchased_at: z.string().datetime({ offset: true }).optional(),
  price_cents: z.number().int().nonnegative().nullable().optional(),
  note: z.string().nullable().optional(),
});

// Markdown import: `## Store` headings + `- [ ]`/`- [x]` rows, matching
// the wiki page this module replaces. `[x]` imports as needed=true.
export const ImportShoppingSchema = z.object({
  text: z.string().min(1),
});

export type ShoppingList = z.infer<typeof ShoppingListSchema>;
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;
export type ShoppingPurchase = z.infer<typeof ShoppingPurchaseSchema>;
export type CreateShoppingList = z.infer<typeof CreateShoppingListSchema>;
export type UpdateShoppingList = z.infer<typeof UpdateShoppingListSchema>;
export type CreateShoppingItem = z.infer<typeof CreateShoppingItemSchema>;
export type UpdateShoppingItem = z.infer<typeof UpdateShoppingItemSchema>;
export type FlagShoppingItem = z.infer<typeof FlagShoppingItemSchema>;
export type PurchaseShoppingItem = z.infer<typeof PurchaseShoppingItemSchema>;
export type ImportShopping = z.infer<typeof ImportShoppingSchema>;
