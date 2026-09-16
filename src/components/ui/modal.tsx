"use client";

import type { ReactNode } from "react";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  /** Critical dialogs must sit above any open feature dialog. */
  layer?: "normal" | "critical";
  size?: "normal" | "wide";
};

export function Modal({
  title,
  children,
  onClose,
  labelledBy = "modal-title",
  layer = "normal",
  size = "normal",
}: ModalProps) {
  return (
    <div
      className={`fixed inset-0 ${layer === "critical" ? "z-[500]" : "z-[100]"} grid place-items-center bg-slate-950/45 p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <section
        className={`flex max-h-[calc(100vh-2rem)] w-full ${size === "wide" ? "max-w-5xl" : "max-w-2xl"} flex-col overflow-hidden rounded-3xl bg-white shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id={labelledBy} className="text-lg font-bold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-full text-lg text-slate-500 hover:bg-slate-100"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </section>
    </div>
  );
}
