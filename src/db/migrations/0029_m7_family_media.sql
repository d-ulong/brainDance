CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid NOT NULL,
	"status" text NOT NULL,
	"declared_mime" text NOT NULL,
	"detected_mime" text,
	"content_sha256" text,
	"byte_size" integer NOT NULL,
	"safe_byte_size" integer,
	"width" integer,
	"height" integer,
	"staging_object_key" text NOT NULL,
	"safe_object_key" text,
	"scan_result" text,
	"scan_error_category" text,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"unreferenced_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "media_objects_status_check" CHECK ("status" IN ('staging', 'processing', 'ready', 'rejected', 'revoked', 'purged')),
	CONSTRAINT "media_objects_scan_result_check" CHECK ("scan_result" IS NULL OR "scan_result" IN ('pending', 'clean', 'rejected', 'error')),
	CONSTRAINT "media_objects_reference_count_check" CHECK ("reference_count" >= 0),
	CONSTRAINT "media_objects_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 10485760),
	CONSTRAINT "media_objects_ready_invariant_check" CHECK (
		("status" <> 'ready')
		OR (
			"scan_result" = 'clean'
			AND "safe_object_key" IS NOT NULL
			AND "detected_mime" IS NOT NULL
			AND "content_sha256" IS NOT NULL
			AND "ready_at" IS NOT NULL
		)
	),
	CONSTRAINT "media_objects_staging_processing_check" CHECK (
		("status" NOT IN ('staging', 'processing'))
		OR ("safe_object_key" IS NULL AND "ready_at" IS NULL)
	),
	CONSTRAINT "media_objects_rejected_check" CHECK (
		("status" <> 'rejected') OR ("scan_result" IN ('rejected', 'error'))
	),
	CONSTRAINT "media_objects_purged_check" CHECK (
		("status" = 'purged' AND "purged_at" IS NOT NULL)
		OR ("status" <> 'purged' AND "purged_at" IS NULL)
	),
	CONSTRAINT "media_objects_purge_after_check" CHECK (
		"purge_after" IS NULL
		OR (
			"unreferenced_at" IS NOT NULL
			AND "purge_after" = "unreferenced_at" + interval '90 days'
		)
	),
	CONSTRAINT "media_objects_uploader_create_idempotency_unique" UNIQUE("uploader_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "media_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"student_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_references_resource_type_check" CHECK ("resource_type" IN ('family_push_version', 'push_answer_version')),
	CONSTRAINT "media_references_purpose_check" CHECK ("purpose" IN ('push_image', 'answer_image', 'handwriting_image')),
	CONSTRAINT "media_references_resource_media_unique" UNIQUE("resource_type","resource_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "media_purge_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"status" text NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_category" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_purge_intents_media_id_unique" UNIQUE("media_id"),
	CONSTRAINT "media_purge_intents_status_check" CHECK ("status" IN ('pending', 'completed', 'dead')),
	CONSTRAINT "media_purge_intents_completed_check" CHECK (
		("status" <> 'completed') OR ("completed_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "media_read_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"media_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"authorization_epoch" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_read_capabilities_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_purge_intents" ADD CONSTRAINT "media_purge_intents_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_read_capabilities" ADD CONSTRAINT "media_read_capabilities_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_read_capabilities" ADD CONSTRAINT "media_read_capabilities_reference_id_media_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."media_references"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_read_capabilities" ADD CONSTRAINT "media_read_capabilities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_read_capabilities" ADD CONSTRAINT "media_read_capabilities_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "media_objects_status_purge_after_idx" ON "media_objects" ("status","purge_after");
--> statement-breakpoint
CREATE INDEX "media_objects_uploader_id_idx" ON "media_objects" ("uploader_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_references_active_purpose_unique" ON "media_references" ("resource_type","resource_id","purpose") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "media_references_active_media_id_idx" ON "media_references" ("media_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "media_read_capabilities_token_hash_expires_at_idx" ON "media_read_capabilities" ("token_hash","expires_at");
--> statement-breakpoint
ALTER TABLE "family_push_versions" DROP CONSTRAINT "family_push_versions_content_check";
--> statement-breakpoint
ALTER TABLE "family_push_versions" ADD CONSTRAINT "family_push_versions_content_check" CHECK (
	char_length("body") <= 10000
	AND ("link_url" IS NULL OR char_length("link_url") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "push_answer_versions" DROP CONSTRAINT "push_answer_versions_body_check";
--> statement-breakpoint
ALTER TABLE "push_answer_versions" ADD CONSTRAINT "push_answer_versions_body_check" CHECK (char_length("body") <= 10000);
