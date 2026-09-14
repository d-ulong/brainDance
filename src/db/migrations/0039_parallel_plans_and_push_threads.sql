-- Expand only: retain existing answers, comments, plans and schedule facts.
ALTER TABLE push_answers DROP CONSTRAINT IF EXISTS push_answers_push_unique;
ALTER TABLE push_answers DROP CONSTRAINT IF EXISTS push_answers_push_student_unique;
CREATE UNIQUE INDEX IF NOT EXISTS push_answers_student_create_idempotency_unique
  ON push_answers(student_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

ALTER TABLE push_comments ADD COLUMN IF NOT EXISTS quoted_answer_id uuid REFERENCES push_answers(id);
ALTER TABLE push_comments ADD COLUMN IF NOT EXISTS quoted_comment_id uuid REFERENCES push_comments(id);
DO $$ BEGIN
  ALTER TABLE push_comments ADD CONSTRAINT push_comments_single_quote_check
    CHECK (NOT (quoted_answer_id IS NOT NULL AND quoted_comment_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE plan_library ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS suppressed_by_schedule_item_id uuid REFERENCES schedule_items(id);
CREATE INDEX IF NOT EXISTS schedule_items_student_time_pending_idx
  ON schedule_items(student_id, scheduled_at)
  WHERE status = 'pending';

ALTER TABLE plan_activations DROP CONSTRAINT IF EXISTS plan_activations_no_overlap;
DROP INDEX IF EXISTS plans_active_formal_student_unique;
