ALTER TABLE "training_sessions" ADD COLUMN "trainee_id" uuid;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD COLUMN "trainee_id" uuid;--> statement-breakpoint
UPDATE "training_sessions" SET "trainee_id" = "student_id" WHERE "trainee_id" IS NULL;--> statement-breakpoint
UPDATE "training_profile_projection" SET "trainee_id" = "student_id" WHERE "trainee_id" IS NULL;--> statement-breakpoint
DO $$
DECLARE
  sessions_null_count integer;
  projection_null_count integer;
BEGIN
  SELECT count(*) INTO sessions_null_count
  FROM "training_sessions"
  WHERE "trainee_id" IS NULL;
  SELECT count(*) INTO projection_null_count
  FROM "training_profile_projection"
  WHERE "trainee_id" IS NULL;
  IF sessions_null_count > 0 OR projection_null_count > 0 THEN
    RAISE EXCEPTION
      'p2_training_trainee_id: cannot backfill trainee_id (% sessions, % projections still null); refusing silent delete',
      sessions_null_count,
      projection_null_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "trainee_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ALTER COLUMN "trainee_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_trainee_id_users_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD CONSTRAINT "training_profile_projection_trainee_id_users_id_fk" FOREIGN KEY ("trainee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_profile_projection" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_start_idempotency_trainee_scoped" ON "training_sessions" USING btree ("trainee_id","start_idempotency_key") WHERE "start_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_submit_idempotency_trainee_scoped" ON "training_sessions" USING btree ("trainee_id","submit_idempotency_key") WHERE "submit_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "training_sessions_trainee_key_date_idx" ON "training_sessions" USING btree ("trainee_id","training_key","family_date");--> statement-breakpoint
CREATE INDEX "training_sessions_trainee_status_idx" ON "training_sessions" USING btree ("trainee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_effective_daily_trainee_unique" ON "training_sessions" ("trainee_id", "training_key", "family_date") WHERE "session_kind" = 'effective' AND "status" = 'completed';--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD CONSTRAINT "training_profile_projection_trainee_unique" UNIQUE("trainee_id","training_key","definition_version","age_band","metric_key");--> statement-breakpoint
CREATE INDEX "training_profile_projection_trainee_key_idx" ON "training_profile_projection" USING btree ("trainee_id","training_key");
