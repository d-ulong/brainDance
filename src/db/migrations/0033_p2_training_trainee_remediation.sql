ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_student_trainee_match_check" CHECK ("student_id" IS NULL OR "student_id" = "trainee_id");--> statement-breakpoint
ALTER TABLE "training_profile_projection" ADD CONSTRAINT "training_profile_projection_student_trainee_match_check" CHECK ("student_id" IS NULL OR "student_id" = "trainee_id");--> statement-breakpoint
INSERT INTO "training_definitions" ("training_key", "version", "age_band", "metric_schema", "active")
VALUES
  (
    'reaction',
    1,
    'adult',
    '{"trialCount": 5}'::jsonb,
    1
  ),
  (
    'stroop',
    1,
    'adult',
    '{"trialCount": 20, "congruentQuota": 10, "incongruentQuota": 10, "colors": ["red", "blue", "green", "yellow"], "minValidMs": 150, "maxValidMs": 3000}'::jsonb,
    1
  ),
  (
    'digit-span',
    1,
    'adult',
    '{"forwardMinLength": 3, "forwardMaxLength": 6, "backwardMinLength": 2, "backwardMaxLength": 5, "attemptsPerLength": 2}'::jsonb,
    1
  )
ON CONFLICT ("training_key", "version", "age_band") DO NOTHING;
