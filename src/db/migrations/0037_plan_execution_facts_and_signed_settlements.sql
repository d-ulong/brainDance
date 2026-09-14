-- Plan items retain their own immutable scoring version. Execution may record a
-- server timestamp for start, completion, or automatic non-completion.
ALTER TABLE fact_versions DROP CONSTRAINT fact_versions_completion_kind_check;
ALTER TABLE fact_versions DROP CONSTRAINT fact_versions_system_invariants_check;
ALTER TABLE fact_versions ADD CONSTRAINT fact_versions_completion_kind_check CHECK (
  (source_kind = 'system' AND completion_kind IN ('on_time', 'late', 'not_applicable'))
  OR (source_kind = 'manual' AND completion_kind = 'not_applicable')
);
ALTER TABLE fact_versions ADD CONSTRAINT fact_versions_system_invariants_check CHECK (
  source_kind <> 'system' OR (
    schedule_item_id IS NOT NULL AND confirmed_at IS NULL AND confirmed_by IS NULL
    AND submitted_by IS NULL AND supersedes_fact_version_id IS NULL
    AND ((fact_key = 'schedule.completed' AND completion_kind IN ('on_time', 'late'))
      OR (fact_key IN ('schedule.started', 'schedule.incomplete') AND completion_kind = 'not_applicable'))
  )
);

-- A rule-defined result may be a deduction. Reversals remain negative only
-- when reversing a previously settled entry.
ALTER TABLE point_ledger_entries DROP CONSTRAINT point_ledger_entries_source_check;
ALTER TABLE point_ledger_entries ADD CONSTRAINT point_ledger_entries_source_check CHECK (
  (source_type = 'settlement' AND settlement_id IS NOT NULL AND source_id = settlement_id AND reverses_entry_id IS NULL)
  OR (source_type = 'reversal' AND reverses_entry_id IS NOT NULL AND amount < 0)
  OR (source_type = 'redemption' AND settlement_id IS NULL AND reverses_entry_id IS NULL AND amount < 0)
);
