CREATE TYPE "public"."training_session_kind" AS ENUM('effective', 'practice');--> statement-breakpoint
CREATE TYPE "public"."training_session_status" AS ENUM('created', 'active', 'submitted', 'validated', 'completed', 'cancelled', 'invalid', 'abandoned');--> statement-breakpoint
CREATE TABLE "training_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_key" text NOT NULL,
	"version" integer NOT NULL,
	"age_band" text NOT NULL,
	"metric_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_definitions_key_version_age_unique" UNIQUE("training_key","version","age_band")
);
--> statement-breakpoint
CREATE TABLE "training_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_events_session_sequence_unique" UNIQUE("session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "training_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"unit" text NOT NULL,
	"is_valid" integer DEFAULT 1 NOT NULL,
	"calculation_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_metrics_session_metric_unique" UNIQUE("session_id","metric_key")
);
--> statement-breakpoint
CREATE TABLE "training_profile_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"training_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"age_band" text NOT NULL,
	"metric_key" text NOT NULL,
	"best_value" numeric(18, 6) NOT NULL,
	"last_value" numeric(18, 6) NOT NULL,
	"window_summary" jsonb,
	"last_source_session_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_profile_projection_unique" UNIQUE("student_id","training_key","definition_version","age_band","metric_key")
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"training_key" text NOT NULL,
	"definition_id" uuid NOT NULL,
	"definition_version" integer NOT NULL,
	"age_band" text NOT NULL,
	"family_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "training_session_status" DEFAULT 'created' NOT NULL,
	"session_kind" "training_session_kind",
	"start_idempotency_key" text,
	"submit_idempotency_key" text,
	"blur_accumulated_ms" integer DEFAULT 0 NOT NULL,
	"invalid_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_start_idempotency_unique" UNIQUE("start_idempotency_key"),
	CONSTRAINT "training_sessions_submit_idempotency_unique" UNIQUE("submit_idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "training_events" ADD CONSTRAINT "training_events_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_metrics" ADD CONSTRAINT "training_metrics_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD CONSTRAINT "training_profile_projection_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD CONSTRAINT "training_profile_projection_last_source_session_id_training_sessions_id_fk" FOREIGN KEY ("last_source_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_definition_id_training_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."training_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_definitions_key_active_idx" ON "training_definitions" USING btree ("training_key","active");--> statement-breakpoint
CREATE INDEX "training_events_session_id_idx" ON "training_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_metrics_session_id_idx" ON "training_metrics" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_profile_projection_student_key_idx" ON "training_profile_projection" USING btree ("student_id","training_key");--> statement-breakpoint
CREATE INDEX "training_sessions_student_key_date_idx" ON "training_sessions" USING btree ("student_id","training_key","family_date");--> statement-breakpoint
CREATE INDEX "training_sessions_student_status_idx" ON "training_sessions" USING btree ("student_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_effective_daily_unique" ON "training_sessions" ("student_id", "training_key", "family_date") WHERE "session_kind" = 'effective' AND "status" = 'completed';