ALTER TABLE goal_assignments DROP CONSTRAINT goal_assignments_terminal_fields_check;
ALTER TABLE goal_assignments ADD CONSTRAINT goal_assignments_terminal_fields_check CHECK (
  (
    (completed_by IS NULL AND completed_at IS NULL)
    OR (completed_by IS NOT NULL AND completed_at IS NOT NULL)
  )
  AND (
    (
      status IN ('pending_approval', 'active')
      AND evaluated_by IS NULL
      AND evaluated_at IS NULL
      AND completed_by IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'completed'
      AND completed_by IS NOT NULL
      AND completed_at IS NOT NULL
      AND evaluated_by IS NULL
      AND evaluated_at IS NULL
    )
    OR (
      status IN ('succeeded', 'failed')
      AND evaluated_by IS NOT NULL
      AND evaluated_at IS NOT NULL
    )
  )
);
