// ---------------------------------------------------------------------------
// Loot detection patterns used to trigger auto-sort of the inventory.
//
// Stateful sorting (sortLootedItems, scheduleLootSort) still lives in
// server.ts because it depends on the MUD session, mapStore, and the
// mud-text listener hub. Only the pure regexes move here.
// ---------------------------------------------------------------------------

/** Matches "Вы взяли <item> из трупа <mob>" — looting from a corpse. */
export const LOOT_FROM_CORPSE_RE = /Вы взяли (.+?) из трупа /gi;

/**
 * Matches "Вы подняли <item>." — picking up from the ground.
 * The (?!труп\b) negative lookahead guards against "Вы подняли труп"
 * (that is not an item we want to auto-sort).
 */
export const PICKUP_FROM_GROUND_RE = /Вы подняли (?!труп\b)(.+?)\./gi;
