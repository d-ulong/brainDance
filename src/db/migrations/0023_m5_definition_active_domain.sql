DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM training_definitions
    WHERE active NOT IN (0, 1)
  ) THEN
    RAISE EXCEPTION 'training_definitions_active_has_invalid_values'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_active_domain';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE training_definitions
  ADD CONSTRAINT training_definitions_active_domain
  CHECK (active IN (0, 1));
