DROP INDEX IF EXISTS "point_rules_active_student_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "point_rules_active_student_template_unique" ON "point_rules" USING btree ("student_id","template_id") WHERE "active" = true;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "point_ledger_entries" ple
SET "created_at" = sub.ordered_at
FROM (
  SELECT id, (timestamp with time zone '2020-01-01T00:00:00Z' + (row_number() OVER (ORDER BY id) - 1) * interval '1 microsecond') AS ordered_at
  FROM "point_ledger_entries"
) sub
WHERE ple.id = sub.id;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "point_ledger_entries_student_order_idx" ON "point_ledger_entries" USING btree ("student_id","created_at","id");--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD COLUMN "replay_idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_attempts_replay_idempotency_unique" ON "worker_attempts" USING btree ("outbox_event_id","replay_idempotency_key") WHERE "outcome" = 'replayed' AND "replay_idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_attempts" DROP CONSTRAINT IF EXISTS "worker_attempts_outcome_fields_check";--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD CONSTRAINT "worker_attempts_outcome_fields_check" CHECK (("outcome" IN ('success', 'failure') AND "finished_at" IS NOT NULL) OR ("outcome" = 'leased' AND "finished_at" IS NULL) OR ("outcome" = 'replayed' AND "finished_at" IS NOT NULL AND "replay_actor_id" IS NOT NULL AND "replay_reason" IS NOT NULL AND "replay_idempotency_key" IS NOT NULL));
