"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { apiLogout } from "@/lib/client/api";
import { ThemeToggle } from "@/components/ui/app-theme";
import { TopTabs } from "@/components/ui/top-tabs";

type PageShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  showLogout?: boolean;
  backHref?: string;
  onBeforeNavigate?: () => boolean | Promise<boolean>;
};

export function PageShell({
  title,
  subtitle,
  children,
  showLogout,
  backHref,
  onBeforeNavigate,
}: PageShellProps) {
  const router = useRouter();

  async function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!onBeforeNavigate) return;
    event.preventDefault();
    if (await onBeforeNavigate()) {
      router.push(href);
    }
  }

  async function logout() {
    if (onBeforeNavigate && !(await onBeforeNavigate())) return;
    await apiLogout();
    window.location.assign("/login");
  }

  return (
    <main className="bd-shell mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm font-black tracking-wide text-[var(--bd-primary)]">
          BrainDance
        </p>
        <ThemeToggle />
      </div>
      <TopTabs onBeforeNavigate={onBeforeNavigate} />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {backHref ? (
            <Link
              href={backHref}
              className="mb-2 inline-block text-sm text-neutral-500 hover:text-neutral-800"
              onClick={(event) => void navigate(event, backHref)}
            >
              ← 返回
            </Link>
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight break-words">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-neutral-600 break-words">{subtitle}</p>
          ) : null}
        </div>
        {showLogout ? (
          <button
            type="button"
            className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
            onClick={() => void logout()}
          >
            退出
          </button>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
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

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return <p className="text-sm text-neutral-500">{label}</p>;
}

export function PrimaryButton({
  children,
  disabled,
  type = "button",
  onClick,
  ...rest
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={`bd-primary min-h-11 w-full rounded-full px-4 py-3 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${rest.className ?? ""}`}
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
