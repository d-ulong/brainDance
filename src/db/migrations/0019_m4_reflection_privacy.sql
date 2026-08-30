CREATE TYPE "public"."reflection_visibility" AS ENUM('normal', 'private');--> statement-breakpoint
CREATE TABLE "daily_reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"family_date" date NOT NULL,
	"visibility" "reflection_visibility" DEFAULT 'normal' NOT NULL,
	"body" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"upsert_idempotency_key" text,
	"delete_idempotency_key" text,
	"deleted_at" timestamp with time zone,
	"body_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reflections_upsert_idempotency_unique" UNIQUE("student_id","upsert_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "daily_reflection_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reflection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"visibility" "reflection_visibility" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reflection_versions_reflection_version_unique" UNIQUE("reflection_id","version")
);
--> statement-breakpoint
CREATE TABLE "private_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"grant_idempotency_key" text,
	"revoke_idempotency_key" text,
	CONSTRAINT "private_access_grants_grant_idempotency_unique" UNIQUE("grant_idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "daily_reflections" ADD CONSTRAINT "daily_reflections_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reflection_versions" ADD CONSTRAINT "daily_reflection_versions_reflection_id_daily_reflections_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "public"."daily_reflections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_access_grants" ADD CONSTRAINT "private_access_grants_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reflections_student_date_active_unique" ON "daily_reflections" ("student_id","family_date") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reflections_delete_idempotency_unique" ON "daily_reflections" ("student_id","delete_idempotency_key") WHERE "delete_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "private_access_grants_active_unique" ON "private_access_grants" ("resource_type","resource_id","parent_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "private_access_grants_revoke_idempotency_unique" ON "private_access_grants" ("revoke_idempotency_key") WHERE "revoke_idempotency_key" IS NOT NULL;
