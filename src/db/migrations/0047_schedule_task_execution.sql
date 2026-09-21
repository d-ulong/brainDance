CREATE TABLE "schedule_task_executions" (
  "schedule_item_id" uuid PRIMARY KEY NOT NULL REFERENCES "schedule_items"("id"),
  "task_type" text NOT NULL DEFAULT 'normal',
  "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pomodoro" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_task_executions_type_check" CHECK ("task_type" IN ('normal', 'homework', 'exercise'))
);
