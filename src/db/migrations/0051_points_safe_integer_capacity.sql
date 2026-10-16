-- Expand only: preserve amounts, support reversing int32 minimum and accumulated balances.
ALTER TABLE point_ledger_entries ALTER COLUMN amount TYPE bigint;
--> statement-breakpoint
ALTER TABLE point_balance_projection ALTER COLUMN balance TYPE bigint;
--> statement-breakpoint
ALTER TABLE point_ledger_entries ADD CONSTRAINT point_ledger_entries_safe_amount_check CHECK (amount BETWEEN -9007199254740991 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE point_balance_projection ADD CONSTRAINT point_balance_projection_safe_balance_check CHECK (balance BETWEEN -9007199254740991 AND 9007199254740991);
