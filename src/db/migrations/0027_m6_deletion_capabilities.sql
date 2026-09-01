CREATE TABLE "deletion_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deletion_request_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text DEFAULT 'deletion.manage' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_capabilities_scope_check" CHECK ("scope" IN ('deletion.manage')),
	CONSTRAINT "deletion_capabilities_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "deletion_capabilities" ADD CONSTRAINT "deletion_capabilities_deletion_request_id_deletion_requests_id_fk" FOREIGN KEY ("deletion_request_id") REFERENCES "public"."deletion_requests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_capabilities" ADD CONSTRAINT "deletion_capabilities_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
