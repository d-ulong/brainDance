CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"goal_id" uuid,
	"plan_kind" text NOT NULL,
	"source_plan_id" uuid,
	"status" text NOT NULL,
	"current_version" uuid,
	"title" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"deactivate_idempotency_key" text,
	"deactivate_idempotency_payload_hash" text,
	CONSTRAINT "plans_status_check" CHECK ("status" IN ('active', 'inactive')),
	CONSTRAINT "plans_create_idempotency_unique" UNIQUE("owner_id","student_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schedule_rule" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone NOT NULL,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	CONSTRAINT "plan_versions_plan_create_idempotency_unique" UNIQUE("plan_id","create_idempotency_key"),
	CONSTRAINT "plan_versions_plan_version_unique" UNIQUE("plan_id","version")
);
--> statement-breakpoint
CREATE TABLE "plan_schedule_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"local_time" time NOT NULL,
	CONSTRAINT "plan_schedule_slots_version_slot_unique" UNIQUE("plan_version_id","slot_key")
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_source_plan_id_plans_id_fk" FOREIGN KEY ("source_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_current_version_plan_versions_id_fk" FOREIGN KEY ("current_version") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_schedule_slots" ADD CONSTRAINT "plan_schedule_slots_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_deactivate_idempotency_unique" ON "plans" USING btree ("id","deactivate_idempotency_key") WHERE "deactivate_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_active_formal_student_unique" ON "plans" USING btree ("student_id") WHERE "status" = 'active' AND "plan_kind" = 'formal';
