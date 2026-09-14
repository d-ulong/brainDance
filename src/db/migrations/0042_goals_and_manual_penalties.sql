CREATE TABLE "goal_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "creator_id" uuid NOT NULL REFERENCES "users"("id"),
  "responsible_parent_id" uuid REFERENCES "users"("id"),
  "source" text NOT NULL,
  "content" text NOT NULL,
  "due_date" date NOT NULL,
  "expected_points" integer,
  "expected_gift" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_definitions_source_check" CHECK ("source" IN ('parent', 'student')),
  CONSTRAINT "goal_definitions_expected_points_check" CHECK ("expected_points" IS NULL OR "expected_points" >= 0)
);
CREATE TABLE "goal_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "definition_id" uuid NOT NULL REFERENCES "goal_definitions"("id"),
  "subject_id" uuid NOT NULL REFERENCES "users"("id"),
  "responsible_parent_id" uuid REFERENCES "users"("id"),
  "status" text NOT NULL,
  "actual_points" integer,
  "actual_gift" text,
  "evaluation_reason" text,
  "evaluated_by" uuid REFERENCES "users"("id"),
  "evaluated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_assignments_definition_subject_unique" UNIQUE("definition_id", "subject_id"),
  CONSTRAINT "goal_assignments_status_check" CHECK ("status" IN ('pending_approval', 'active', 'succeeded', 'failed')),
  CONSTRAINT "goal_assignments_actual_points_check" CHECK ("actual_points" IS NULL OR "actual_points" >= 0),
  CONSTRAINT "goal_assignments_terminal_fields_check" CHECK (("status" IN ('pending_approval', 'active') AND "evaluated_by" IS NULL AND "evaluated_at" IS NULL) OR ("status" IN ('succeeded', 'failed') AND "evaluated_by" IS NOT NULL AND "evaluated_at" IS NOT NULL))
);
CREATE TABLE "goal_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id"),
  "key" text NOT NULL,
  "payload_hash" text NOT NULL,
  "result" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_commands_actor_key_unique" UNIQUE("actor_id", "key")
);
CREATE TABLE "manual_point_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "student_id" uuid NOT NULL REFERENCES "users"("id"),
  "actor_parent_id" uuid NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "amount" integer NOT NULL,
  "reason" text NOT NULL,
  "original_adjustment_id" uuid REFERENCES "manual_point_adjustments"("id"),
  "ledger_entry_id" uuid NOT NULL REFERENCES "point_ledger_entries"("id"),
  "idempotency_key" text NOT NULL,
  "payload_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "manual_point_adjustments_actor_key_unique" UNIQUE("actor_parent_id", "idempotency_key"),
  CONSTRAINT "manual_point_adjustments_kind_check" CHECK ("kind" IN ('penalty', 'reversal')),
  CONSTRAINT "manual_point_adjustments_amount_check" CHECK (("kind" = 'penalty' AND "amount" < 0 AND "original_adjustment_id" IS NULL) OR ("kind" = 'reversal' AND "amount" > 0 AND "original_adjustment_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "manual_point_adjustments_one_reversal_unique" ON "manual_point_adjustments" ("original_adjustment_id") WHERE "kind" = 'reversal';
ALTER TABLE "point_ledger_entries" DROP CONSTRAINT "point_ledger_entries_source_check";
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_source_check" CHECK (
  ("source_type" = 'settlement' AND "settlement_id" IS NOT NULL AND "source_id" = "settlement_id" AND "reverses_entry_id" IS NULL)
  OR ("source_type" = 'reversal' AND "reverses_entry_id" IS NOT NULL AND "amount" < 0)
  OR ("source_type" = 'redemption' AND "settlement_id" IS NULL AND "reverses_entry_id" IS NULL AND "amount" < 0)
  OR ("source_type" = 'goal_reward' AND "settlement_id" IS NULL AND "reverses_entry_id" IS NULL AND "amount" > 0)
  OR ("source_type" = 'manual_penalty' AND "settlement_id" IS NULL AND "reverses_entry_id" IS NULL AND "amount" < 0)
  OR ("source_type" = 'manual_penalty_reversal' AND "settlement_id" IS NULL AND "reverses_entry_id" IS NOT NULL AND "amount" > 0)
);
CREATE UNIQUE INDEX "point_ledger_entries_goal_reward_source_unique"
  ON "point_ledger_entries" ("source_id") WHERE "source_type" = 'goal_reward';
