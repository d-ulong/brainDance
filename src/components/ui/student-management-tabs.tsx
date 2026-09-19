"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "学生列表", href: "/parent/students", current: (path: string) => path === "/parent/students" },
  { label: "目标", href: "/parent/goals", current: (path: string) => path.startsWith("/parent/goals") },
  { label: "计划", href: "/parent/plans", current: (path: string) => path.startsWith("/parent/plans") },
  { label: "推送", href: "/parent/pushes", current: (path: string) => path.startsWith("/parent/pushes") },
  { label: "兑换", href: "/parent/redemption", current: (path: string) => path.startsWith("/parent/redemption") },
] as const;

/** The parent-only second-level navigation under the primary Student tab. */
export function StudentManagementTabs() {
  const pathname = usePathname();
  return (
    <nav className="bd-student-mgmt-tabs" aria-label="学生管理">
      {tabs.map((tab) => {
        const active = tab.current(pathname);
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
