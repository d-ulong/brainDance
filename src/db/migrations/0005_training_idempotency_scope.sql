ALTER TABLE "training_sessions" DROP CONSTRAINT IF EXISTS "training_sessions_start_idempotency_unique";--> statement-breakpoint
ALTER TABLE "training_sessions" DROP CONSTRAINT IF EXISTS "training_sessions_submit_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_start_idempotency_scoped" ON "training_sessions" USING btree ("student_id","start_idempotency_key") WHERE "start_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_submit_idempotency_scoped" ON "training_sessions" USING btree ("student_id","submit_idempotency_key") WHERE "submit_idempotency_key" is not null;
