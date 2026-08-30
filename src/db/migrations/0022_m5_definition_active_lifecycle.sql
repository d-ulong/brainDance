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

  IF OLD.active IS DISTINCT FROM NEW.active THEN
    IF OLD.active NOT IN (0, 1) OR NEW.active NOT IN (0, 1) THEN
      RAISE EXCEPTION 'training_definition_active_invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'training_definitions_active_lifecycle';
    END IF;

    IF NOT (OLD.active = NEW.active OR (OLD.active = 1 AND NEW.active = 0)) THEN
      RAISE EXCEPTION 'training_definition_active_transition_forbidden'
        USING ERRCODE = '23514',
              CONSTRAINT = 'training_definitions_active_lifecycle';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
