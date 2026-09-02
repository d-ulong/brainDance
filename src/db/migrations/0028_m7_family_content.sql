CREATE TABLE "family_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"creator_parent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"scheduled_publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_pushes_status_check" CHECK ("status" IN ('draft', 'scheduled', 'published', 'disabled', 'deleted', 'cancelled')),
	CONSTRAINT "family_pushes_current_version_positive_check" CHECK ("current_version" > 0),
	CONSTRAINT "family_pushes_state_invariants_check" CHECK (
		("status" = 'draft' AND "scheduled_publish_at" IS NULL AND "published_at" IS NULL)
		OR ("status" = 'scheduled' AND "scheduled_publish_at" IS NOT NULL AND "published_at" IS NULL)
		OR ("status" = 'published' AND "published_at" IS NOT NULL)
		OR ("status" = 'disabled' AND "published_at" IS NOT NULL)
		OR ("status" = 'deleted')
		OR ("status" = 'cancelled' AND "published_at" IS NULL)
	),
	CONSTRAINT "family_pushes_creator_create_idempotency_unique" UNIQUE("creator_parent_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "family_push_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_push_versions_version_positive_check" CHECK ("version" > 0),
	CONSTRAINT "family_push_versions_content_check" CHECK (
		length(trim("body")) > 0 OR ("link_url" IS NOT NULL AND length(trim("link_url")) > 0)
	),
	CONSTRAINT "family_push_versions_push_version_unique" UNIQUE("push_id","version")
);
--> statement-breakpoint
CREATE TABLE "push_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"create_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_answers_current_version_positive_check" CHECK ("current_version" > 0),
	CONSTRAINT "push_answers_push_unique" UNIQUE("push_id"),
	CONSTRAINT "push_answers_push_student_unique" UNIQUE("push_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "push_answer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"submit_idempotency_key" text NOT NULL,
	"submit_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_answer_versions_version_positive_check" CHECK ("version" > 0),
	CONSTRAINT "push_answer_versions_body_check" CHECK (length(trim("body")) > 0),
	CONSTRAINT "push_answer_versions_answer_version_unique" UNIQUE("answer_id","version"),
	CONSTRAINT "push_answer_versions_answer_submit_idempotency_unique" UNIQUE("answer_id","submit_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "push_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"current_version" integer DEFAULT 1 NOT NULL,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_comments_current_version_positive_check" CHECK ("current_version" > 0),
	CONSTRAINT "push_comments_author_create_idempotency_unique" UNIQUE("author_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "push_comment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"mutate_idempotency_key" text,
	"mutate_idempotency_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_comment_versions_version_positive_check" CHECK ("version" > 0),
	CONSTRAINT "push_comment_versions_body_check" CHECK (length(trim("body")) > 0),
	CONSTRAINT "push_comment_versions_comment_version_unique" UNIQUE("comment_id","version")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notification_type" IN ('family_push.published', 'family_push.answered', 'family_push.commented')),
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "family_pushes" ADD CONSTRAINT "family_pushes_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "family_pushes" ADD CONSTRAINT "family_pushes_creator_parent_id_users_id_fk" FOREIGN KEY ("creator_parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "family_push_versions" ADD CONSTRAINT "family_push_versions_push_id_family_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."family_pushes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_answers" ADD CONSTRAINT "push_answers_push_id_family_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."family_pushes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_answers" ADD CONSTRAINT "push_answers_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_answer_versions" ADD CONSTRAINT "push_answer_versions_answer_id_push_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."push_answers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_comments" ADD CONSTRAINT "push_comments_push_id_family_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."family_pushes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_comments" ADD CONSTRAINT "push_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_comments" ADD CONSTRAINT "push_comments_parent_comment_id_push_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."push_comments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_comment_versions" ADD CONSTRAINT "push_comment_versions_comment_id_push_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."push_comments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "push_comment_versions_mutate_idempotency_unique" ON "push_comment_versions" ("mutate_idempotency_key") WHERE "mutate_idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "family_pushes_student_status_idx" ON "family_pushes" ("student_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "family_pushes_creator_status_idx" ON "family_pushes" ("creator_parent_id","status");
--> statement-breakpoint
CREATE INDEX "push_comments_push_created_idx" ON "push_comments" ("push_id","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" ("recipient_user_id","created_at");
