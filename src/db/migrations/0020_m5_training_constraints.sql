CREATE UNIQUE INDEX IF NOT EXISTS "training_definitions_active_key_age_unique" ON "training_definitions" ("training_key","age_band") WHERE "active" = 1;
