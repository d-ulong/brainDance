import type { ButtonHTMLAttributes, ReactNode } from "react";

type TrainingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "option";
};

export function TrainingButton({
  children,
  variant = "primary",
  className,
  ...rest
}: TrainingButtonProps) {
  const base =
    "min-h-11 rounded-2xl px-4 py-3 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--bd-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "option"
      ? "border border-neutral-300 bg-white hover:bg-neutral-50"
      : "bd-primary text-white";

  return (
    <button type="button" className={`${base} ${styles} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}
