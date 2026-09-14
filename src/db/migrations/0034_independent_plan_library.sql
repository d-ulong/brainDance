CREATE TABLE plan_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1, definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plan_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), library_id uuid NOT NULL REFERENCES plan_library(id),
  student_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_bindings_library_student_unique UNIQUE(library_id,student_id)
);
CREATE TABLE plan_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), binding_id uuid NOT NULL REFERENCES plan_bindings(id),
  student_id uuid NOT NULL REFERENCES users(id), execution_plan_id uuid NOT NULL REFERENCES plans(id),
  effective_from date NOT NULL, effective_until date, definition jsonb NOT NULL, revision integer NOT NULL,
  CONSTRAINT plan_activations_execution_unique UNIQUE(execution_plan_id),
  CONSTRAINT plan_activations_range_check CHECK(effective_until IS NULL OR effective_until >= effective_from)
);
-- The student row is also locked by activation commands; the exclusion protects alternate writers.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE plan_activations ADD CONSTRAINT plan_activations_no_overlap
  EXCLUDE USING gist (student_id WITH =, daterange(effective_from,effective_until,'[)') WITH &&);
CREATE TABLE plan_item_rules (
  schedule_item_id uuid PRIMARY KEY REFERENCES schedule_items(id),
  rule_version_id uuid NOT NULL REFERENCES point_rule_versions(id), entry jsonb NOT NULL, started_at timestamptz
);
CREATE TABLE plan_library_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_library_commands_actor_key_unique UNIQUE(actor_id,key)
);
INSERT INTO point_rule_templates(id,event_type,parameter_schema,effect_schema,stacking_mode,active,created_at)
VALUES ('plan_entry_conditions_v1','schedule.completed','{}','{}','none',true,now());
