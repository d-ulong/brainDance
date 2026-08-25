import Link from "next/link";
import type { ReactNode } from "react";

import { apiLogout } from "@/lib/client/api";

type PageShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  showLogout?: boolean;
  backHref?: string;
};

export function PageShell({ title, subtitle, children, showLogout, backHref }: PageShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {backHref ? (
            <Link
              href={backHref}
              className="mb-2 inline-block text-sm text-neutral-500 hover:text-neutral-800"
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
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
            onClick={() => void apiLogout().then(() => window.location.assign("/login"))}
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
      className={`rounded-xl border px-4 py-3 text-sm break-words ${styles} ${className ?? ""}`}
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
      className={`min-h-11 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-neutral-500 ${props.className ?? ""}`}
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
