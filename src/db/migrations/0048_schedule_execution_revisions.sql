ALTER TABLE schedule_task_executions ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE schedule_task_executions ADD CONSTRAINT schedule_task_executions_revision_check CHECK (revision >= 0);
CREATE TABLE schedule_execution_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  schedule_item_id uuid NOT NULL REFERENCES schedule_items(id),
  key text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_execution_commands_actor_item_key_unique UNIQUE(actor_id, schedule_item_id, key)
);
