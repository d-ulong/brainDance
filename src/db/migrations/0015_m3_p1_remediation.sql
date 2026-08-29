DROP INDEX IF EXISTS "point_ledger_entries_reversal_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_reversal_unique" ON "point_ledger_entries" USING btree ("reverses_entry_id") WHERE "reverses_entry_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "outbox_events_claim_eligible_idx";--> statement-breakpoint
CREATE INDEX "outbox_events_claim_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_claim_expired_lease_idx" ON "outbox_events" USING btree ("leased_until") WHERE "status" = 'leased';--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempts_nonneg_check" CHECK ("attempts" >= 0);--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD CONSTRAINT "worker_attempts_attempt_number_positive_check" CHECK ("attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD CONSTRAINT "worker_attempts_outcome_fields_check" CHECK (
  ("outcome" IN ('success', 'failure') AND "finished_at" IS NOT NULL)
  OR ("outcome" = 'leased' AND "finished_at" IS NULL)
  OR (
    "outcome" = 'replayed'
    AND "finished_at" IS NOT NULL
    AND "replay_actor_id" IS NOT NULL
    AND "replay_reason" IS NOT NULL
  )
);--> statement-breakpoint
INSERT INTO "point_rule_templates" ("id", "event_type", "parameter_schema", "effect_schema", "negative_effect_schema", "limits", "stacking_mode", "active", "created_at")
VALUES (
	'schedule_error_count_v1',
	'schedule.error_count',
	'{"maximumErrorCount": 3}'::jsonb,
	'{"amount": 10}'::jsonb,
	NULL,
	NULL,
	'none',
	true,
	now()
)
ON CONFLICT ("id") DO NOTHING;
