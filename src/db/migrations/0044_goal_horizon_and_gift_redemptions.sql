ALTER TABLE "goal_definitions" ADD COLUMN "horizon" text DEFAULT 'medium' NOT NULL;
ALTER TABLE "goal_definitions" ADD CONSTRAINT "goal_definitions_horizon_check" CHECK ("horizon" IN ('short', 'medium', 'long'));

CREATE TABLE "goal_gift_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "recorded_by" uuid NOT NULL,
  "redeemed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_gift_redemptions_assignment_id_unique" UNIQUE("assignment_id"),
  CONSTRAINT "goal_gift_redemptions_assignment_id_goal_assignments_id_fk"
    FOREIGN KEY ("assignment_id") REFERENCES "goal_assignments"("id"),
  CONSTRAINT "goal_gift_redemptions_recorded_by_users_id_fk"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id")
);

CREATE INDEX "goal_gift_redemptions_recorded_by_idx" ON "goal_gift_redemptions" ("recorded_by");
