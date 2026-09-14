-- A skipped scan is an explicit local-pilot exception, never a clean scan verdict.
-- Runtime checks still reject skipped media outside local pilot mode.
ALTER TABLE media_objects DROP CONSTRAINT media_objects_scan_result_check;
--> statement-breakpoint
ALTER TABLE media_objects ADD CONSTRAINT media_objects_scan_result_check
  CHECK (scan_result IS NULL OR scan_result IN ('pending', 'clean', 'skipped', 'rejected', 'error'));
--> statement-breakpoint
ALTER TABLE media_objects DROP CONSTRAINT media_objects_ready_invariant_check;
--> statement-breakpoint
ALTER TABLE media_objects ADD CONSTRAINT media_objects_ready_invariant_check CHECK (
  status <> 'ready' OR (
    scan_result IN ('clean', 'skipped')
    AND safe_object_key IS NOT NULL
    AND detected_mime IS NOT NULL
    AND content_sha256 IS NOT NULL
    AND ready_at IS NOT NULL
  )
);
