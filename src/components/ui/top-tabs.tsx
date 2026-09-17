"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchSession, type SessionInfo } from "@/lib/client/api";

type TopTabsProps = {
  onBeforeNavigate?: () => boolean | Promise<boolean>;
};

type Tab = {
  id: string;
  href: string;
  label: string;
  icon: string;
  matches: (pathname: string) => boolean;
};

const TABS_BY_ROLE: Record<SessionInfo["role"], Tab[]> = {
  student: [
    { id: "home", href: "/", label: "首页", icon: "🏠", matches: (path) => path === "/" },
    {
      id: "training",
      href: "/student/training",
      label: "训练",
      icon: "🧩",
      matches: (path) => path.startsWith("/student/training"),
    },
    {
      id: "pushes",
      href: "/student/pushes",
      label: "推送",
      icon: "💌",
      matches: (path) => path.startsWith("/student/pushes"),
    },
    {
      id: "plans",
      href: "/student/plans",
      label: "计划日程",
      icon: "🗓️",
      matches: (path) => path.startsWith("/student/plans") || path.startsWith("/student/schedule"),
    },
    {
      id: "profile",
      href: "/account",
      label: "我的",
      icon: "🌟",
      matches: (path) =>
        path === "/account" ||
        path.startsWith("/student/link") ||
        path.startsWith("/student/export") ||
        path.startsWith("/student/reflection") ||
        path.startsWith("/student/redemption") ||
        path.startsWith("/student/account-deletion") ||
        path.startsWith("/student/change-password"),
    },
  ],
  parent: [
    { id: "home", href: "/", label: "首页", icon: "🏠", matches: (path) => path === "/" },
    {
      id: "students",
      href: "/parent/students",
      label: "学生",
      icon: "🧒",
      matches: (path) =>
        path.startsWith("/parent/students") ||
        path.startsWith("/parent/goals") ||
        path.startsWith("/parent/plans") ||
        path.startsWith("/parent/pushes") ||
        path.startsWith("/parent/redemption") ||
        path.startsWith("/parent/link"),
    },
    {
      id: "profile",
      href: "/account",
      label: "我的",
      icon: "🌟",
      matches: (path) =>
        path === "/account" ||
        path.startsWith("/parent/change-password") ||
        path.startsWith("/parent/training"),
    },
  ],
  admin: [
    { id: "home", href: "/", label: "首页", icon: "🏠", matches: (path) => path === "/" },
    {
      id: "invitations",
      href: "/admin/invitations",
      label: "邀请码",
      icon: "✉️",
      matches: (path) => path.startsWith("/admin/invitations"),
    },
    {
      id: "profile",
      href: "/account",
      label: "我的",
      icon: "🌟",
      matches: (path) => path === "/account",
    },
  ],
};

function mayShowTabs(session: SessionInfo | null | undefined): session is SessionInfo {
  return Boolean(
    session &&
    (session.role === "admin" || (session.contactVerified && !session.mustChangePassword)),
  );
}

export function TopTabs({ onBeforeNavigate }: TopTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((value) => {
      if (!cancelled) setSession(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // While session is loading, reserve nav space with a lightweight skeleton so the masthead
  // does not pop in after the first paint (root cause: client-only fetchSession gate).
  if (session === undefined) {
    return (
      <nav className="bd-top-tabs bd-top-tabs-loading" aria-label="主要功能" aria-busy="true" data-testid="top-tabs-loading">
        <span className="bd-top-tab bd-top-tab-skeleton" />
        <span className="bd-top-tab bd-top-tab-skeleton" />
        <span className="bd-top-tab bd-top-tab-skeleton" />
      </nav>
    );
  }

  if (!mayShowTabs(session)) return null;

  const tabs = TABS_BY_ROLE[session.role];

  async function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (href === pathname) {
      event.preventDefault();
      return;
    }
    if (!onBeforeNavigate) return;

    event.preventDefault();
    if (await onBeforeNavigate()) {
      router.push(href);
    }
  }

  return (
    <nav className="bd-top-tabs" aria-label="主要功能" data-testid="top-tabs">
      {tabs.map((tab) => {
        const current = tab.matches(pathname);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            data-testid={`top-tab-${session.role}-${tab.id}`}
            aria-current={current ? "page" : undefined}
            className={`bd-top-tab ${current ? "bd-top-tab-current" : ""}`}
            onClick={(event) => void navigate(event, tab.href)}
          >
            <span aria-hidden>{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
