"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  /**
   * Layering:
   * - normal: feature forms (z-100)
   * - critical: blocking confirms that sit above feature dialogs (z-500)
   * - alert: errors that must sit above any open feature/critical dialog (z-600)
   */
  layer?: "normal" | "critical" | "alert";
  size?: "normal" | "wide";
};

const layerClass = {
  normal: "z-[100]",
  critical: "z-[500]",
  alert: "z-[600]",
} as const;

export function Modal({
  title,
  children,
  onClose,
  labelledBy = "modal-title",
  layer = "normal",
  size = "normal",
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${layerClass[layer]} grid place-items-center bg-slate-950/45 p-4`}
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
    </div>,
    document.body,
  );
}
