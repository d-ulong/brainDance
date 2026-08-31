ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_source_check";--> statement-breakpoint
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
