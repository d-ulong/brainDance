CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"scope_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"artifact_key" text,
	"download_token_hash" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "export_jobs_status_check" CHECK ("status" IN ('pending', 'processing', 'ready', 'failed', 'expired', 'revoked')),
	CONSTRAINT "export_jobs_requester_create_idempotency_unique" UNIQUE("requester_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text NOT NULL,
	"revocable_until" timestamp with time zone NOT NULL,
	"student_confirmed_at" timestamp with time zone,
	"admin_force_reason" text,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_requests_target_type_check" CHECK ("target_type" IN ('student_account', 'daily_reflection')),
	CONSTRAINT "deletion_requests_status_check" CHECK ("status" IN ('requested', 'frozen', 'cancelled', 'executed')),
	CONSTRAINT "deletion_requests_requester_create_idempotency_unique" UNIQUE("requested_by","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "deletion_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deletion_request_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"tombstone_version" integer DEFAULT 1 NOT NULL,
	"purged_at" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_tombstones_deletion_request_unique" UNIQUE("deletion_request_id"),
	CONSTRAINT "deletion_tombstones_target_unique" UNIQUE("target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "deletion_execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deletion_request_id" uuid NOT NULL,
	"step_version" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_execution_steps_request_step_unique" UNIQUE("deletion_request_id","step_version")
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_tombstones" ADD CONSTRAINT "deletion_tombstones_deletion_request_id_deletion_requests_id_fk" FOREIGN KEY ("deletion_request_id") REFERENCES "public"."deletion_requests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_tombstones" ADD CONSTRAINT "deletion_tombstones_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_execution_steps" ADD CONSTRAINT "deletion_execution_steps_deletion_request_id_deletion_requests_id_fk" FOREIGN KEY ("deletion_request_id") REFERENCES "public"."deletion_requests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_download_token_hash_unique" ON "export_jobs" USING btree ("download_token_hash") WHERE "download_token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_active_target_unique" ON "deletion_requests" USING btree ("target_type","target_id") WHERE "status" IN ('requested', 'frozen');
