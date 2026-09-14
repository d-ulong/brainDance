ALTER TABLE fact_versions DROP CONSTRAINT fact_versions_completion_kind_check;
ALTER TABLE fact_versions ADD CONSTRAINT fact_versions_completion_kind_check
  CHECK (
    (source_kind = 'system' AND completion_kind IN ('on_time', 'late', 'not_applicable'))
    OR (source_kind = 'manual' AND completion_kind IN ('on_time', 'late', 'not_applicable'))
  );

ALTER TABLE fact_versions DROP CONSTRAINT fact_versions_manual_invariants_check;
ALTER TABLE fact_versions ADD CONSTRAINT fact_versions_manual_invariants_check
  CHECK (
    source_kind <> 'manual'
    OR (
      schedule_item_id IS NOT NULL
      AND submitted_by IS NOT NULL
      AND (
        (
          fact_key = 'schedule.error_count'
          AND completion_kind = 'not_applicable'
          AND value ? 'error_count'
          AND ((value->>'error_count') ~ '^[0-9]+$')
        )
        OR (
          fact_key = 'schedule.completed'
          AND completion_kind IN ('on_time', 'late')
          AND value ?& ARRAY['started_at','completed_at','duration_minutes']
        )
      )
    )
  );
