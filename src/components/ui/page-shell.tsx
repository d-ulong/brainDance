"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { apiLogout, fetchSession, type SessionInfo } from "@/lib/client/api";
import { ThemeToggle } from "@/components/ui/app-theme";
import { TopTabs } from "@/components/ui/top-tabs";
import { BrandLogo } from "@/components/ui/brand-logo";

function formatShanghaiClock(date: Date) {
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(date);
  const rest = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${rest} ${weekday}`;
}

function ShellShanghaiClock() {
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      setClock(formatShanghaiClock(new Date()));
      const now = new Date();
      const shanghai = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
      const msUntilNextMinute = (60 - shanghai.getSeconds()) * 1000 - shanghai.getMilliseconds();
      timer = setTimeout(schedule, Math.max(msUntilNextMinute, 1_000));
    }

    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <time
      className="bd-shell-clock hidden text-right text-xs leading-snug text-[var(--bd-muted)] sm:block"
      dateTime={clock ?? undefined}
      suppressHydrationWarning
      data-testid="shell-shanghai-clock"
    >
      {clock ?? "\u00a0"}
    </time>
  );
}

function shellDisplayName(session: SessionInfo) {
  if (session.displayName?.trim()) return session.displayName.trim();
  if (session.account?.trim()) return session.account.trim();
  return session.role === "student" ? "学生" : session.role === "parent" ? "家长" : "成员";
}

function ShellIdentityCluster({ session }: { session: SessionInfo | null }) {
  if (!session) return null;

  const name = shellDisplayName(session);

  return (
    <div className="bd-shell-identity flex max-w-[min(16rem,52vw)] items-center justify-end gap-2">
      <ShellShanghaiClock />
      <span
        className="truncate text-sm font-semibold text-[var(--bd-text)]"
        data-testid="shell-display-name"
      >
        {name}
      </span>
    </div>
  );
}

type PageShellProps = {
  title: string;
  subtitle?: string;
  subtitleKind?: "help" | "status";
  headingAside?: ReactNode;
  children: ReactNode;
  showLogout?: boolean;
  backHref?: string;
  secondaryNavigation?: ReactNode;
  hideHeading?: boolean;
  hideTabs?: boolean;
  showThemeToggle?: boolean;
  onBeforeNavigate?: () => boolean | Promise<boolean>;
};

export function PageShell({
  title,
  subtitle,
  subtitleKind = "help",
  children,
  showLogout,
  backHref,
  headingAside,
  secondaryNavigation,
  hideHeading = false,
  hideTabs = false,
  showThemeToggle = false,
  onBeforeNavigate,
}: PageShellProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const showPageHeading = !hideHeading || Boolean(backHref);

  useEffect(() => {
    if (!showLogout) return;
    void fetchSession().then(setSession);
  }, [showLogout]);

  async function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    if (onBeforeNavigate && !(await onBeforeNavigate())) return;
    // Keep navigation inside the App Router so the shared masthead/top tabs stay
    // mounted and only the destination detail view changes.
    router.push(href);
  }

  async function logout() {
    if (onBeforeNavigate && !(await onBeforeNavigate())) return;
    await apiLogout();
    window.location.assign("/login");
  }

  return (
    <div className="bd-app">
      <main className="bd-shell mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-8">
        <header className="bd-masthead flex items-center justify-between gap-3">
          <Link href="/" className="min-w-0 shrink" onClick={(event) => void navigate(event, "/")}>
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-2">
            {showThemeToggle ? <ThemeToggle /> : null}
            {showLogout ? <ShellIdentityCluster session={session} /> : null}
            {showLogout ? (
              <>
                <Link
                  href="/account"
                  className="bd-shell-avatar shrink-0"
                  aria-label={session ? `账号：${shellDisplayName(session)}` : "我的账号"}
                  data-testid="shell-account-link"
                  onClick={(event) => void navigate(event, "/account")}
                >
                  <span aria-hidden="true">
                    {session ? shellDisplayName(session).slice(0, 1) : "…"}
                  </span>
                </Link>
                <button
                  type="button"
                  className="bd-shell-logout shrink-0"
                  onClick={() => void logout()}
                >
                  退出
                </button>
              </>
            ) : null}
          </div>
        </header>
        <div className="bd-app-body">
          {hideTabs ? null : <TopTabs onBeforeNavigate={onBeforeNavigate} />}
          <div className="bd-main-column">
            {secondaryNavigation ? (
              <div className="flex items-center justify-between gap-3">{secondaryNavigation}</div>
            ) : null}
            {showPageHeading ? (
              <header className="bd-page-heading flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {backHref ? (
                    <Link
                      href={backHref}
                      className="bd-back-link bd-back-link-inline mt-0.5 shrink-0"
                      onClick={(event) => void navigate(event, backHref)}
                      data-testid="page-back-link"
                    >
                      ← 返回
                    </Link>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold tracking-tight break-words">{title}</h1>
                    {subtitle && subtitleKind === "status" ? (
                      <p className="mt-1 text-sm font-semibold text-[var(--bd-primary)]">
                        {subtitle}
                      </p>
                    ) : subtitle ? (
                      <p className="mt-1 text-sm break-words text-[var(--bd-muted)]">{subtitle}</p>
                    ) : null}
                  </div>
                </div>
                {headingAside ? (
                  <div className="bd-heading-aside w-full min-w-[min(100%,12rem)] sm:ml-auto sm:w-auto sm:max-w-[min(100%,20rem)] sm:text-right">
                    {headingAside}
                  </div>
                ) : null}
              </header>
            ) : (
              <h1 className="sr-only">{title}</h1>
            )}
            <div className="bd-content flex flex-1 flex-col gap-4">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
  className,
  ...rest
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-green-200 bg-green-50 text-green-800"
        : "border-neutral-200 bg-white text-neutral-700";

  return (
    <div
      {...rest}
      className={`rounded-2xl border px-4 py-3 text-sm break-words ${styles} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function Toast({
  message,
  tone = "success",
  onClose,
}: {
  message: string | null;
  tone?: "success" | "error" | "info";
  onClose: () => void;
}) {
  if (!message) return null;
  const toneClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "info"
        ? "border-blue-200 bg-blue-50 text-blue-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <div
      className={`fixed inset-x-4 top-4 z-[210] mx-auto flex w-auto max-w-lg items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      <p className="min-w-0 flex-1 text-sm font-semibold">{message}</p>
      <button
        type="button"
        className="min-h-8 min-w-8 rounded-full text-lg leading-none"
        aria-label="关闭提示"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return <p className="text-sm text-neutral-500">{label}</p>;
}

export function PrimaryButton({
  children,
  disabled,
  type = "button",
  onClick,
  fullWidth = true,
  ...rest
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  fullWidth?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={`bd-primary min-h-11 ${fullWidth ? "w-full" : "w-auto"} rounded-full px-4 py-3 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  type = "button",
  ...rest
}: {
  children: ReactNode;
  type?: "button" | "submit";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className={`min-h-10 rounded-full border border-[var(--bd-border)] bg-[var(--bd-surface)] px-3 py-2 text-sm font-bold text-[var(--bd-text)] transition hover:bg-[var(--bd-surface-soft)] ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`bd-input min-h-11 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] px-3 py-2 text-base text-[var(--bd-text)] outline-none transition placeholder:text-[var(--bd-muted)] disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="bd-field flex flex-col gap-2 text-sm font-medium text-[var(--bd-text)]">
      <span className="bd-field-label">{label}</span>
      {children}
    </label>
  );
}
