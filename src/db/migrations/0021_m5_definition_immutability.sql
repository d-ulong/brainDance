CREATE OR REPLACE FUNCTION prevent_training_definition_immutable_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.training_key IS DISTINCT FROM NEW.training_key THEN
    RAISE EXCEPTION 'training_definition_training_key_immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_immutable_fields';
  END IF;

  IF OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'training_definition_version_immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_immutable_fields';
  END IF;

  IF OLD.age_band IS DISTINCT FROM NEW.age_band THEN
    RAISE EXCEPTION 'training_definition_age_band_immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_immutable_fields';
  END IF;

  IF OLD.metric_schema IS DISTINCT FROM NEW.metric_schema THEN
    RAISE EXCEPTION 'training_definition_metric_schema_immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_immutable_fields';
  END IF;

  IF OLD.active = 0 AND NEW.active = 1 THEN
    RAISE EXCEPTION 'training_definition_reactivation_forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'training_definitions_reactivation_forbidden';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS training_definitions_immutable_guard ON training_definitions;--> statement-breakpoint
CREATE TRIGGER training_definitions_immutable_guard
  BEFORE UPDATE ON training_definitions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_training_definition_immutable_update();
