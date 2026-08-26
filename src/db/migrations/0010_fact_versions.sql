CREATE TABLE "fact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"source_kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"idempotency_payload_hash" text NOT NULL,
	"completion_kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"asserted_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"supersedes_fact_version_id" uuid,
	"voided_at" timestamp with time zone,
	CONSTRAINT "fact_versions_completion_kind_check" CHECK ("completion_kind" IN ('on_time', 'late')),
	CONSTRAINT "fact_versions_schedule_item_idempotency_unique" UNIQUE("schedule_item_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_supersedes_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("supersedes_fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE no action ON UPDATE no action;
