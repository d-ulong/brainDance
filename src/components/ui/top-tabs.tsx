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
    { id: "home", href: "/", label: "今天", icon: "🏠", matches: (path) => path === "/" },
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
      label: "家庭推送",
      icon: "💌",
      matches: (path) => path.startsWith("/student/pushes"),
    },
    {
      id: "schedule",
      href: "/student/plans?view=schedule",
      label: "计划日程",
      icon: "🗓️",
      matches: (path) => path.startsWith("/student/plans") || path.startsWith("/student/schedule"),
    },
    {
      id: "profile",
      href: "/account",
      label: "我的",
      icon: "👤",
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
    { id: "home", href: "/", label: "今天", icon: "🏠", matches: (path) => path === "/" },
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
      id: "training",
      href: "/parent/training",
      label: "训练",
      icon: "🧩",
      matches: (path) => path.startsWith("/parent/training"),
    },
    {
      id: "profile",
      href: "/account",
      label: "我的",
      icon: "👤",
      matches: (path) =>
        path === "/account" ||
        path.startsWith("/parent/change-password") ||
        path.startsWith("/parent/my-redemption"),
    },
  ],
  admin: [
    { id: "home", href: "/", label: "首页", icon: "🏠", matches: (path) => path === "/" },
    {
      id: "accounts",
      href: "/admin/accounts",
      label: "账号",
      icon: "👥",
      matches: (path) => path.startsWith("/admin/accounts"),
    },
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
      matches: (path) => path === "/account" || path === "/change-password",
    },
  ],
};

function mayShowTabs(session: SessionInfo | null | undefined): session is SessionInfo {
  return Boolean(
    session && !session.mustChangePassword && (session.role === "admin" || session.contactVerified),
  );
}

export function TopTabs({ onBeforeNavigate }: TopTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessionFailed(false);
    setSession(undefined);
    void fetchSession()
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
          setSessionFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionAttempt]);

  if (sessionFailed)
    return (
      <nav className="bd-top-tabs" aria-label="主要功能" data-testid="top-tabs-error">
        <p role="alert" className="text-sm">
          导航暂时无法加载。
        </p>
        <button
          type="button"
          className="min-h-11 rounded-full border px-3"
          onClick={() => setSessionAttempt((attempt) => attempt + 1)}
        >
          重试导航
        </button>
      </nav>
    );

  // While session is loading, reserve nav space with a lightweight skeleton so the masthead
  // does not pop in after the first paint (root cause: client-only fetchSession gate).
  if (session === undefined) {
    return (
      <nav
        className="bd-top-tabs bd-top-tabs-loading"
        aria-label="主要功能"
        aria-busy="true"
        data-testid="top-tabs-loading"
      >
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
