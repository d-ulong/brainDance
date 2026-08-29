ALTER TABLE "fact_versions" ALTER COLUMN "schedule_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" DROP CONSTRAINT "fact_versions_completion_kind_check";--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_source_kind_check" CHECK ("source_kind" IN ('system', 'manual'));--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_completion_kind_check" CHECK (
  ("source_kind" = 'system' AND "completion_kind" IN ('on_time', 'late'))
  OR ("source_kind" = 'manual' AND "completion_kind" = 'not_applicable')
);--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_schedule_item_binding_check" CHECK (
  ("source_kind" IN ('system', 'manual') AND "schedule_item_id" IS NOT NULL)
  OR ("source_kind" NOT IN ('system', 'manual') AND "schedule_item_id" IS NULL)
);--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_confirmation_pair_check" CHECK (
  ("confirmed_at" IS NULL AND "confirmed_by" IS NULL)
  OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_manual_invariants_check" CHECK (
  "source_kind" <> 'manual'
  OR (
    "schedule_item_id" IS NOT NULL
    AND "fact_key" = 'schedule.error_count'
    AND "submitted_by" IS NOT NULL
    AND "completion_kind" = 'not_applicable'
    AND "value" ? 'error_count'
    AND (("value"->>'error_count') ~ '^[0-9]+$')
  )
);--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_system_invariants_check" CHECK (
  "source_kind" <> 'system'
  OR (
    "schedule_item_id" IS NOT NULL
    AND "fact_key" = 'schedule.completed'
    AND "completion_kind" IN ('on_time', 'late')
    AND "confirmed_at" IS NULL
    AND "confirmed_by" IS NULL
    AND "submitted_by" IS NULL
    AND "supersedes_fact_version_id" IS NULL
  )
);--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_correction_reason_check" CHECK (
  "supersedes_fact_version_id" IS NULL OR "correction_reason" IS NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "fact_versions_supersedes_predecessor_unique" ON "fact_versions" USING btree ("supersedes_fact_version_id") WHERE "supersedes_fact_version_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_source_check";--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_source_check" CHECK (
  (
    "source_type" = 'settlement'
    AND "source_id" = "settlement_id"
    AND "reverses_entry_id" IS NULL
    AND "amount" >= 0
  )
  OR (
    "source_type" = 'reversal'
    AND "reverses_entry_id" IS NOT NULL
    AND "amount" < 0
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_reversal_idempotency_unique" ON "point_ledger_entries" USING btree ("reverses_entry_id", "idempotency_key") WHERE "reverses_entry_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_status_check" CHECK ("status" IN ('pending', 'leased', 'processed', 'dead'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_lease_fields_check" CHECK (
  "status" <> 'leased'
  OR ("leased_until" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_owner" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "outbox_events_claim_eligible_idx" ON "outbox_events" USING btree ("available_at") WHERE "status" IN ('pending', 'leased');--> statement-breakpoint
CREATE INDEX "outbox_events_dead_list_idx" ON "outbox_events" USING btree ("created_at") WHERE "status" = 'dead';--> statement-breakpoint
CREATE TABLE "worker_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error_category" text,
	"replay_actor_id" uuid,
	"replay_reason" text,
	"lease_token" uuid,
	CONSTRAINT "worker_attempts_outbox_attempt_unique" UNIQUE("outbox_event_id","attempt_number"),
	CONSTRAINT "worker_attempts_outcome_check" CHECK ("outcome" IN ('success', 'failure', 'leased', 'replayed'))
);--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD CONSTRAINT "worker_attempts_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_attempts" ADD CONSTRAINT "worker_attempts_replay_actor_id_users_id_fk" FOREIGN KEY ("replay_actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_attempts_outbox_event_idx" ON "worker_attempts" USING btree ("outbox_event_id");
