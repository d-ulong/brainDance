CREATE TABLE "point_rule_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"parameter_schema" jsonb NOT NULL,
	"effect_schema" jsonb NOT NULL,
	"negative_effect_schema" jsonb,
	"limits" jsonb,
	"stacking_mode" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"creator_parent_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "point_rules_creator_student_create_idempotency_unique" UNIQUE("creator_parent_id","student_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "point_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"point_rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parameters" jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"priority" integer,
	"effective_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "point_rule_versions_status_check" CHECK ("status" IN ('active', 'superseded')),
	CONSTRAINT "point_rule_versions_rule_version_unique" UNIQUE("point_rule_id","version")
);
--> statement-breakpoint
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_creator_parent_id_users_id_fk" FOREIGN KEY ("creator_parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_template_id_point_rule_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."point_rule_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rule_versions" ADD CONSTRAINT "point_rule_versions_point_rule_id_point_rules_id_fk" FOREIGN KEY ("point_rule_id") REFERENCES "public"."point_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_rules_active_student_unique" ON "point_rules" USING btree ("student_id") WHERE "active" = true;--> statement-breakpoint
INSERT INTO "point_rule_templates" ("id", "event_type", "parameter_schema", "effect_schema", "negative_effect_schema", "limits", "stacking_mode", "active", "created_at")
VALUES (
	'schedule_system_complete_v1',
	'schedule.completed',
	'{}'::jsonb,
	'{"amount": 10, "rewardsLateCompletion": true}'::jsonb,
	NULL,
	NULL,
	'none',
	true,
	now()
);
