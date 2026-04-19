-- Baseline schema snapshot of production on 2026-04-18.
-- This migration is SEEDED (not executed) on production DBs via runner.ts baseline-pump.
-- Captured via pg_dump --schema-only --no-owner --no-privileges; sanitized for portability:
--   * stripped \restrict / \unrestrict directives
--   * stripped public. schema qualifier
--   * added IF NOT EXISTS to every CREATE TABLE / CREATE SEQUENCE / CREATE INDEX
--   * wrapped ADD CONSTRAINT and ADD FOREIGN KEY in DO blocks guarded by pg_constraint lookup
-- On fresh-install this file runs once; idempotent re-runs are safe.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS auto_spells_settings (
    profile_id text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id bigint NOT NULL,
    text text NOT NULL,
    ts bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE chat_messages_id_seq OWNED BY chat_messages.id;

CREATE TABLE IF NOT EXISTS farm_zone_settings (
    profile_id text NOT NULL,
    zone_id integer NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS game_items (
    name text NOT NULL,
    item_type text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    has_wiki_data boolean DEFAULT false NOT NULL,
    has_game_data boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS map_aliases (
    vnum integer NOT NULL,
    alias text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS map_edges (
    from_vnum integer NOT NULL,
    to_vnum integer NOT NULL,
    direction text NOT NULL,
    is_portal boolean DEFAULT false NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS map_rooms (
    vnum integer NOT NULL,
    name text NOT NULL,
    exits text[] DEFAULT '{}'::text[] NOT NULL,
    closed_exits text[] DEFAULT '{}'::text[] NOT NULL,
    visited boolean DEFAULT true NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    color text
);

CREATE TABLE IF NOT EXISTS market_sales (
    id bigint NOT NULL,
    source text NOT NULL,
    lot_number integer,
    item_name text NOT NULL,
    price integer NOT NULL,
    is_ours boolean DEFAULT false NOT NULL,
    sold_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS market_sales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE market_sales_id_seq OWNED BY market_sales.id;

CREATE TABLE IF NOT EXISTS mob_names (
    id integer NOT NULL,
    room_name text,
    combat_name text,
    last_seen_vnum integer,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    blacklisted boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS mob_names_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE mob_names_id_seq OWNED BY mob_names.id;

CREATE TABLE IF NOT EXISTS quest_completions (
    quest_id text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    grivnas integer
);

CREATE TABLE IF NOT EXISTS room_auto_commands (
    vnum integer NOT NULL,
    command text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS room_colors (
    vnum integer NOT NULL,
    color text NOT NULL
);

CREATE TABLE IF NOT EXISTS sneak_settings (
    profile_id text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS survival_settings (
    id integer DEFAULT 1 NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT survival_settings_id_check CHECK ((id = 1))
);

CREATE TABLE IF NOT EXISTS trigger_settings (
    profile_id text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_names (
    zone_id integer NOT NULL,
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_script_settings (
    id text DEFAULT 'global'::text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================================
-- Sequence defaults
-- ============================================================================

ALTER TABLE ONLY chat_messages ALTER COLUMN id SET DEFAULT nextval('chat_messages_id_seq'::regclass);
ALTER TABLE ONLY market_sales ALTER COLUMN id SET DEFAULT nextval('market_sales_id_seq'::regclass);
ALTER TABLE ONLY mob_names ALTER COLUMN id SET DEFAULT nextval('mob_names_id_seq'::regclass);

-- ============================================================================
-- Primary keys and unique constraints (guarded — PG has no ADD CONSTRAINT IF NOT EXISTS)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_spells_settings_pkey') THEN
    ALTER TABLE auto_spells_settings ADD CONSTRAINT auto_spells_settings_pkey PRIMARY KEY (profile_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_pkey') THEN
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'farm_zone_settings_pkey') THEN
    ALTER TABLE farm_zone_settings ADD CONSTRAINT farm_zone_settings_pkey PRIMARY KEY (profile_id, zone_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_items_pkey') THEN
    ALTER TABLE game_items ADD CONSTRAINT game_items_pkey PRIMARY KEY (name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_aliases_pkey') THEN
    ALTER TABLE map_aliases ADD CONSTRAINT map_aliases_pkey PRIMARY KEY (vnum);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_edges_pkey') THEN
    ALTER TABLE map_edges ADD CONSTRAINT map_edges_pkey PRIMARY KEY (from_vnum, to_vnum, direction);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_rooms_pkey') THEN
    ALTER TABLE map_rooms ADD CONSTRAINT map_rooms_pkey PRIMARY KEY (vnum);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_sales_pkey') THEN
    ALTER TABLE market_sales ADD CONSTRAINT market_sales_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mob_names_pkey') THEN
    ALTER TABLE mob_names ADD CONSTRAINT mob_names_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mob_names_room_name_key') THEN
    ALTER TABLE mob_names ADD CONSTRAINT mob_names_room_name_key UNIQUE (room_name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quest_completions_pkey') THEN
    ALTER TABLE quest_completions ADD CONSTRAINT quest_completions_pkey PRIMARY KEY (quest_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_auto_commands_pkey') THEN
    ALTER TABLE room_auto_commands ADD CONSTRAINT room_auto_commands_pkey PRIMARY KEY (vnum);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_colors_pkey') THEN
    ALTER TABLE room_colors ADD CONSTRAINT room_colors_pkey PRIMARY KEY (vnum);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sneak_settings_pkey') THEN
    ALTER TABLE sneak_settings ADD CONSTRAINT sneak_settings_pkey PRIMARY KEY (profile_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'survival_settings_pkey') THEN
    ALTER TABLE survival_settings ADD CONSTRAINT survival_settings_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trigger_settings_pkey') THEN
    ALTER TABLE trigger_settings ADD CONSTRAINT trigger_settings_pkey PRIMARY KEY (profile_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_names_pkey') THEN
    ALTER TABLE zone_names ADD CONSTRAINT zone_names_pkey PRIMARY KEY (zone_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_script_settings_pkey') THEN
    ALTER TABLE zone_script_settings ADD CONSTRAINT zone_script_settings_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS map_edges_to_vnum_idx ON map_edges USING btree (to_vnum);
CREATE INDEX IF NOT EXISTS market_sales_item_name_idx ON market_sales USING btree (item_name);
CREATE INDEX IF NOT EXISTS market_sales_sold_at_idx ON market_sales USING btree (sold_at DESC);

-- ============================================================================
-- Foreign keys (guarded)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_aliases_vnum_fkey') THEN
    ALTER TABLE map_aliases ADD CONSTRAINT map_aliases_vnum_fkey FOREIGN KEY (vnum) REFERENCES map_rooms(vnum) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_edges_from_vnum_fkey') THEN
    ALTER TABLE map_edges ADD CONSTRAINT map_edges_from_vnum_fkey FOREIGN KEY (from_vnum) REFERENCES map_rooms(vnum) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_edges_to_vnum_fkey') THEN
    ALTER TABLE map_edges ADD CONSTRAINT map_edges_to_vnum_fkey FOREIGN KEY (to_vnum) REFERENCES map_rooms(vnum) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_auto_commands_vnum_fkey') THEN
    ALTER TABLE room_auto_commands ADD CONSTRAINT room_auto_commands_vnum_fkey FOREIGN KEY (vnum) REFERENCES map_rooms(vnum) ON DELETE CASCADE;
  END IF;
END $$;
