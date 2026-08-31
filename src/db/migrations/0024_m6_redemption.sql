CREATE TABLE "redemption_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"creator_parent_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cost" integer NOT NULL,
	"monthly_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "redemption_catalog_items_cost_check" CHECK ("cost" > 0),
	CONSTRAINT "redemption_catalog_items_monthly_limit_check" CHECK ("monthly_limit" IS NULL OR "monthly_limit" > 0),
	CONSTRAINT "redemption_catalog_items_creator_create_idempotency_unique" UNIQUE("creator_parent_id","create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "point_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"cost_snapshot" integer NOT NULL,
	"request_month" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"rejection_reason" text,
	"ledger_entry_id" uuid,
	"create_idempotency_key" text NOT NULL,
	"create_idempotency_payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "point_redemptions_cost_snapshot_check" CHECK ("cost_snapshot" > 0),
	CONSTRAINT "point_redemptions_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "point_redemptions_request_month_check" CHECK ("request_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "point_redemptions_state_invariants_check" CHECK (
		("status" = 'pending' AND "confirmed_at" IS NULL AND "confirmed_by" IS NULL AND "ledger_entry_id" IS NULL AND "rejection_reason" IS NULL)
		OR ("status" = 'approved' AND "confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "ledger_entry_id" IS NOT NULL AND "rejection_reason" IS NULL)
		OR ("status" = 'rejected' AND "confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "ledger_entry_id" IS NULL AND "rejection_reason" IS NOT NULL AND length(trim("rejection_reason")) > 0)
		OR ("status" = 'cancelled' AND "confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "ledger_entry_id" IS NULL AND "rejection_reason" IS NULL)
	),
	CONSTRAINT "point_redemptions_student_create_idempotency_unique" UNIQUE("student_id","create_idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "redemption_catalog_items" ADD CONSTRAINT "redemption_catalog_items_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "redemption_catalog_items" ADD CONSTRAINT "redemption_catalog_items_creator_parent_id_users_id_fk" FOREIGN KEY ("creator_parent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_catalog_item_id_redemption_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."redemption_catalog_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "point_redemptions_ledger_entry_unique" ON "point_redemptions" USING btree ("ledger_entry_id") WHERE "ledger_entry_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_settlement_id_settlements_id_fk";
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_source_id_settlements_id_fk";
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_settlement_id_unique";
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ALTER COLUMN "settlement_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_source_check";
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_source_check" CHECK (
	(
		"source_type" = 'settlement'
		AND "settlement_id" IS NOT NULL
		AND "source_id" = "settlement_id"
		AND "reverses_entry_id" IS NULL
		AND "amount" >= 0
	)
	OR (
		"source_type" = 'reversal'
		AND "reverses_entry_id" IS NOT NULL
		AND "amount" < 0
	)
	OR (
		"source_type" = 'redemption'
		AND "settlement_id" IS NULL
		AND "reverses_entry_id" IS NULL
		AND "amount" < 0
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_settlement_id_unique" ON "point_ledger_entries" USING btree ("settlement_id") WHERE "settlement_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_redemption_source_unique" ON "point_ledger_entries" USING btree ("source_id") WHERE "source_type" = 'redemption';
--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "point_redemptions" ADD CONSTRAINT "point_redemptions_ledger_entry_id_point_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."point_ledger_entries"("id") ON DELETE no action ON UPDATE no action;
