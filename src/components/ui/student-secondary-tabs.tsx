"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StudentSecondaryTabs({ studentId }: { studentId: string }) {
  const pathname = usePathname();
  const tabs = [
    ["目标", "/parent/goals"],
    ["计划", `/parent/students/${studentId}/plans`],
    ["推送", `/parent/students/${studentId}/pushes`],
    ["日程", `/parent/students/${studentId}/schedule`],
    ["兑换", "/parent/redemption"],
  ] as const;
  return <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="学生管理">
    {tabs.map(([label, href]) => {
      const current = pathname.startsWith(href);
      return <Link key={label} href={href} className={`shrink-0 rounded-full px-3 py-2 text-sm ${current ? "bg-[var(--bd-primary)] text-white" : "bg-white text-neutral-700"}`}>{label}</Link>;
    })}
  </nav>;
}
