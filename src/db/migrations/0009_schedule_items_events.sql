CREATE TABLE "schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"family_date" date NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'plan' NOT NULL,
	"occurrence_key" text NOT NULL,
	"plan_snapshot" jsonb,
	CONSTRAINT "schedule_items_status_check" CHECK ("status" IN ('pending', 'completed', 'skipped', 'expired', 'cancelled')),
	CONSTRAINT "schedule_items_occurrence_key_unique" UNIQUE("occurrence_key")
);
--> statement-breakpoint
CREATE TABLE "schedule_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"idempotency_payload_hash" text NOT NULL,
	"completion_kind" text,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schedule_events_item_idempotency_unique" UNIQUE("schedule_item_id","idempotency_key"),
	CONSTRAINT "schedule_events_from_status_check" CHECK ("from_status" IN ('pending')),
	CONSTRAINT "schedule_events_to_status_check" CHECK ("to_status" IN ('completed', 'skipped')),
	CONSTRAINT "schedule_events_completion_reason_check" CHECK (("to_status" = 'completed' AND "completion_kind" IN ('on_time', 'late') AND "reason" IS NULL) OR ("to_status" = 'skipped' AND "completion_kind" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
