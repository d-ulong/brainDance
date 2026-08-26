CREATE TABLE "schedule_horizon_maintains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"idempotency_payload_hash" text NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schedule_horizon_maintains_student_actor_idempotency_unique" UNIQUE("student_id","actor_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "schedule_horizon_maintains" ADD CONSTRAINT "schedule_horizon_maintains_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_horizon_maintains" ADD CONSTRAINT "schedule_horizon_maintains_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
