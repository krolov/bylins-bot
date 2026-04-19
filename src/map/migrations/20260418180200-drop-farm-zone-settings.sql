-- Destructive migration: drops legacy farm_zone_settings if it exists with old PK shape.
-- Guard checks PRIMARY KEY constraint name == 'farm_zone_settings_pkey' AND absence of
-- profile_id column, then drops. Extracted verbatim from src/map/store.ts:198-213.
-- WARNING: listed in docs/refactor-playbook.md "destructive migrations list".
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'farm_zone_settings'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'farm_zone_settings_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'farm_zone_settings'
      AND column_name = 'profile_id'
  ) THEN
    DROP TABLE farm_zone_settings;
  END IF;
END $$;
