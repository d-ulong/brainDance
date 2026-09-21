"use client";

import type { LinkedStudentDto } from "@/lib/client/m2-api";

type StudentMultiSelectProps = {
  students: LinkedStudentDto[];
  selectedIds: string[];
  onChange: (studentIds: string[]) => void;
  emptyLabel?: string;
  label?: string;
  disabled?: boolean;
};

export function StudentMultiSelect({
  students,
  selectedIds,
  onChange,
  emptyLabel = "请选择学生",
  label = "选择学生",
  disabled = false,
}: StudentMultiSelectProps) {
  const selected = students.filter((student) => selectedIds.includes(student.studentId));

  function toggle(studentId: string, checked: boolean) {
    if (disabled) return;
    onChange(
      checked
        ? [...new Set([...selectedIds, studentId])]
        : selectedIds.filter((id) => id !== studentId),
    );
  }

  return (
    <div className="bd-student-multi-select space-y-2">
      <details className="rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] text-[var(--bd-text)]">
        <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-sm font-medium text-[var(--bd-text)]">
          {selected.length ? `已选择 ${selected.length} 名学生` : emptyLabel}
        </summary>
        <div className="max-h-52 space-y-1 overflow-y-auto border-t p-2">
          {students.length ? (
            students.map((student) => (
              <label
                className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-[var(--bd-text)] hover:bg-[var(--bd-surface)]"
                key={student.studentId}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selectedIds.includes(student.studentId)}
                  onChange={(event) => toggle(student.studentId, event.target.checked)}
                />
                <span>{student.displayName || student.username || "未命名学生"}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-[var(--bd-muted)]">暂无已关联学生</p>
          )}
        </div>
      </details>
      {selected.length ? (
        <div className="flex flex-wrap gap-2" aria-label={label}>
          {selected.map((student) => (
            <button
              type="button"
              key={student.studentId}
              disabled={disabled}
              className="min-h-9 rounded-full border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] px-3 text-sm font-semibold text-[var(--bd-primary)] disabled:opacity-60"
              onClick={() => toggle(student.studentId, false)}
            >
              {student.displayName || student.username || "未命名学生"} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
