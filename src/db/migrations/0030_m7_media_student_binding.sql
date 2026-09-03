ALTER TABLE "media_objects" ADD COLUMN "student_id" uuid;--> statement-breakpoint
UPDATE "media_objects"
SET "student_id" = NULLIF(split_part("staging_object_key", '/', 2), '')::uuid
WHERE "student_id" IS NULL
  AND "staging_object_key" ~ '^staging/[0-9a-fA-F-]{36}/';--> statement-breakpoint
DO $$
DECLARE
  unbackfillable_count integer;
BEGIN
  SELECT count(*) INTO unbackfillable_count
  FROM "media_objects"
  WHERE "student_id" IS NULL;
  IF unbackfillable_count > 0 THEN
    RAISE EXCEPTION
      'm7_media_student_binding: % media_objects row(s) cannot be uniquely backfilled to student_id; refusing silent delete',
      unbackfillable_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "student_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_objects_student_id_idx" ON "media_objects" ("student_id");--> statement-breakpoint
ALTER TABLE "media_purge_intents" DROP CONSTRAINT "media_purge_intents_status_check";--> statement-breakpoint
ALTER TABLE "media_purge_intents" ADD CONSTRAINT "media_purge_intents_status_check" CHECK ("status" IN ('pending', 'prepared', 'completed', 'dead'));
