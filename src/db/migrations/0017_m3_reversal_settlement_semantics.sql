ALTER TABLE "settlements" DROP CONSTRAINT "settlements_result_check";--> statement-breakpoint
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_fact_rule_period_unique";--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_result_check" CHECK ("result" IN ('reward', 'reversal'));--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_fact_rule_period_result_unique" UNIQUE("fact_version_id","rule_version_id","settlement_period","result");--> statement-breakpoint
