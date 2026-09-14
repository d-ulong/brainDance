"use client";

import { useEffect, useState } from "react";
import { fetchLinkedStudents } from "@/lib/client/m2-api";

export function StudentContextBanner({ studentId, label = "当前学生" }: { studentId: string; label?: string }) {
  const [name, setName] = useState("正在确认学生…");
  useEffect(() => {
    let active = true;
    void fetchLinkedStudents().then(({ students }) => {
      const student = students.find((item) => item.studentId === studentId);
      if (active) setName(student?.displayName || student?.username || "学生信息不可用");
    }).catch(() => { if (active) setName("学生信息不可用"); });
    return () => { active = false; };
  }, [studentId]);
  return <aside className="bd-student-context" aria-label={`${label}：${name}`}><span aria-hidden="true">👤</span><span><small>{label}</small><strong>{name}</strong></span><em>以下操作仅作用于该学生</em></aside>;
}
