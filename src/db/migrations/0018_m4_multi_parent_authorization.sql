CREATE OR REPLACE FUNCTION check_student_single_active_family()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1
    FROM relationships r
    WHERE r.student_id = NEW.student_id
      AND r.status = 'active'
      AND r.family_id <> NEW.family_id
      AND r.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'student_active_family_conflict'
      USING ERRCODE = '23514',
            CONSTRAINT = 'relationships_student_single_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS relationships_student_single_active_family_trg ON relationships;--> statement-breakpoint
CREATE TRIGGER relationships_student_single_active_family_trg
  BEFORE INSERT OR UPDATE OF status, family_id, student_id ON relationships
  FOR EACH ROW
  EXECUTE FUNCTION check_student_single_active_family();--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_memberships_active_family_user_unique" ON "family_memberships" ("family_id", "user_id") WHERE "left_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_memberships_user_active_idx" ON "family_memberships" ("user_id") WHERE "left_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_family_parent_active_idx" ON "relationships" ("family_id", "parent_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_family_student_active_idx" ON "relationships" ("family_id", "student_id") WHERE "status" = 'active';
