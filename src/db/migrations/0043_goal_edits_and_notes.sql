ALTER TABLE "goal_definitions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;

CREATE TABLE "goal_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL REFERENCES "goal_assignments"("id"),
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_notes_body_check" CHECK (length(trim("body")) BETWEEN 1 AND 1000)
);

CREATE INDEX "goal_notes_assignment_created_idx" ON "goal_notes" ("assignment_id", "created_at");
