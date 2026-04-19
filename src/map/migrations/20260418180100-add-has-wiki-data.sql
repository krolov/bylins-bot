-- Add wiki/game data flag columns to game_items.
-- Extracted from inline DDL at src/map/store.ts:255-260 (pre-Phase-1 location).
-- Idempotent via IF NOT EXISTS. On production this migration is SEEDED (not executed)
-- because the baseline schema already contains the columns.
ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_game_data BOOLEAN NOT NULL DEFAULT FALSE;
