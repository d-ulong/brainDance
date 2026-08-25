CREATE TYPE "public"."relationship_request_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."relationship_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_role" "user_role" NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"derived_from_relationship_id" uuid
);
--> statement-breakpoint
CREATE TABLE "relationship_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"association_code_id" uuid NOT NULL,
	"status" "relationship_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"create_idempotency_key" text,
	"respond_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_requests_create_idempotency_unique" UNIQUE("create_idempotency_key"),
	CONSTRAINT "relationship_requests_respond_idempotency_unique" UNIQUE("respond_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_association_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"issue_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_association_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "student_association_codes_issue_idempotency_unique" UNIQUE("issue_idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_derived_from_relationship_id_relationships_id_fk" FOREIGN KEY ("derived_from_relationship_id") REFERENCES "public"."relationships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_requests" ADD CONSTRAINT "relationship_requests_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_requests" ADD CONSTRAINT "relationship_requests_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_requests" ADD CONSTRAINT "relationship_requests_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_requests" ADD CONSTRAINT "relationship_requests_association_code_id_student_association_codes_id_fk" FOREIGN KEY ("association_code_id") REFERENCES "public"."student_association_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_association_codes" ADD CONSTRAINT "student_association_codes_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_memberships_family_user_idx" ON "family_memberships" USING btree ("family_id","user_id");--> statement-breakpoint
CREATE INDEX "relationship_requests_student_status_idx" ON "relationship_requests" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "relationships_parent_id_idx" ON "relationships" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "relationships_student_id_idx" ON "relationships" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "relationships_family_id_idx" ON "relationships" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "student_association_codes_student_id_idx" ON "student_association_codes" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_active_parent_student_unique" ON "relationships" ("parent_id", "student_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "student_association_codes_active_student_unique" ON "student_association_codes" ("student_id") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;