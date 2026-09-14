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
      <section className={`max-h-[calc(100vh-2rem)] w-full ${size === "wide" ? "max-w-5xl" : "max-w-2xl"} overflow-y-auto rounded-3xl bg-white p-5 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between gap-3">
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
        {children}
      </section>
    </div>
  );
}
