"use client";

import type { LinkedStudentDto } from "@/lib/client/m2-api";

type StudentMultiSelectProps = {
  students: LinkedStudentDto[];
  selectedIds: string[];
  onChange: (studentIds: string[]) => void;
  emptyLabel?: string;
  label?: string;
};

export function StudentMultiSelect({
  students,
  selectedIds,
  onChange,
  emptyLabel = "请选择学生",
  label = "选择学生",
}: StudentMultiSelectProps) {
  const selected = students.filter((student) => selectedIds.includes(student.studentId));

  function toggle(studentId: string, checked: boolean) {
    onChange(
      checked
        ? [...new Set([...selectedIds, studentId])]
        : selectedIds.filter((id) => id !== studentId),
    );
  }

  return (
    <div className="space-y-2">
      <details className="rounded-2xl border border-neutral-300 bg-white">
        <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-sm text-neutral-700">
          {selected.length ? `已选择 ${selected.length} 名学生` : emptyLabel}
        </summary>
        <div className="max-h-52 space-y-1 overflow-y-auto border-t p-2">
          {students.length ? (
            students.map((student) => (
              <label
                className="flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-slate-50"
                key={student.studentId}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(student.studentId)}
                  onChange={(event) => toggle(student.studentId, event.target.checked)}
                />
                <span>{student.displayName || student.username || "未命名学生"}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-neutral-500">暂无已关联学生</p>
          )}
        </div>
      </details>
      {selected.length ? (
        <div className="flex flex-wrap gap-2" aria-label={label}>
          {selected.map((student) => (
            <button
              type="button"
              key={student.studentId}
              className="min-h-9 rounded-full bg-violet-100 px-3 text-sm text-violet-800"
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
