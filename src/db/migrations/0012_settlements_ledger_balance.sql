CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"fact_version_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"settlement_period" date NOT NULL,
	"result" text NOT NULL,
	"explanation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "settlements_result_check" CHECK ("result" IN ('reward')),
	CONSTRAINT "settlements_fact_rule_period_unique" UNIQUE("fact_version_id","rule_version_id","settlement_period")
);
--> statement-breakpoint
CREATE TABLE "point_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"explanation" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reverses_entry_id" uuid,
	"created_by" uuid,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "point_ledger_entries_settlement_id_unique" UNIQUE("settlement_id"),
	CONSTRAINT "point_ledger_entries_source_check" CHECK ("source_type" = 'settlement' AND "source_id" = "settlement_id")
);
--> statement-breakpoint
CREATE TABLE "point_balance_projection" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"last_ledger_entry_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_rule_version_id_point_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."point_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_source_id_settlements_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_reverses_entry_id_point_ledger_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."point_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_balance_projection" ADD CONSTRAINT "point_balance_projection_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_balance_projection" ADD CONSTRAINT "point_balance_projection_last_ledger_entry_id_point_ledger_entries_id_fk" FOREIGN KEY ("last_ledger_entry_id") REFERENCES "public"."point_ledger_entries"("id") ON DELETE no action ON UPDATE no action;
