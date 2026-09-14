"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { apiLogout } from "@/lib/client/api";
import { ThemeToggle } from "@/components/ui/app-theme";
import { TopTabs } from "@/components/ui/top-tabs";
import { BrandLogo } from "@/components/ui/brand-logo";

type PageShellProps = {
  title: string;
  subtitle?: string;
  subtitleKind?: "help" | "status";
  children: ReactNode;
  showLogout?: boolean;
  backHref?: string;
  secondaryNavigation?: ReactNode;
  hideHeading?: boolean;
  onBeforeNavigate?: () => boolean | Promise<boolean>;
};

export function PageShell({
  title,
  subtitle,
  subtitleKind = "help",
  children,
  showLogout,
  backHref,
  secondaryNavigation,
  hideHeading = false,
  onBeforeNavigate,
}: PageShellProps) {
  const router = useRouter();

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
    <main className="bd-shell mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-8">
      <div className="bd-masthead flex items-center justify-between gap-3">
        <BrandLogo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {showLogout ? (
            <button
              type="button"
              className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
              onClick={() => void logout()}
            >
              退出
            </button>
          ) : null}
        </div>
      </div>
      <TopTabs onBeforeNavigate={onBeforeNavigate} />
      {secondaryNavigation || backHref ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">{secondaryNavigation}</div>
          {backHref ? (
            <Link
              href={backHref}
              className="shrink-0 rounded-full border border-[var(--bd-border)] bg-white px-3 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
              onClick={(event) => void navigate(event, backHref)}
            >
              ← 返回
            </Link>
          ) : null}
        </div>
      ) : null}
      {hideHeading ? <h1 className="sr-only">{title}</h1> : <header className="bd-page-heading flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="inline text-xl font-bold tracking-tight break-words">{title}</h1>
          {subtitle && subtitleKind === "status" ? (
            <p className="mt-1 text-sm font-semibold text-[var(--bd-primary)]">{subtitle}</p>
          ) : subtitle ? (
            <details className="bd-page-help">
              <summary>使用说明</summary>
              <p className="mt-2 text-sm text-neutral-600 break-words">{subtitle}</p>
            </details>
          ) : null}
        </div>
      </header>}
      <div className="bd-content flex flex-1 flex-col gap-4">{children}</div>
    </main>
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
    <div className={`fixed inset-x-4 top-4 z-[210] mx-auto flex w-auto max-w-lg items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 ${toneClass}`} role="status" aria-live="polite">
      <p className="min-w-0 flex-1 text-sm font-semibold">{message}</p>
      <button type="button" className="min-h-8 min-w-8 rounded-full text-lg leading-none" aria-label="关闭提示" onClick={onClose}>×</button>
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
      className={`bd-input min-h-11 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-base outline-none transition ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-neutral-800">
      <span>{label}</span>
      {children}
    </label>
  );
}
