ALTER TABLE family_pushes
  ADD COLUMN answer_disclosure_days integer;
ALTER TABLE family_pushes
  ADD CONSTRAINT family_pushes_answer_disclosure_days_check
  CHECK (answer_disclosure_days IS NULL OR answer_disclosure_days BETWEEN 0 AND 365);

ALTER TABLE push_library_entries
  ADD COLUMN answer_disclosure_days integer;
ALTER TABLE push_library_entries
  ADD CONSTRAINT push_library_entries_answer_disclosure_days_check
  CHECK (answer_disclosure_days IS NULL OR answer_disclosure_days BETWEEN 0 AND 365);
