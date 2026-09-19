"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
   * - alert: errors that sit above any open feature/critical dialog (z-600)
   */
  layer?: "normal" | "critical" | "alert";
  size?: "normal" | "wide";
  /** When true, Escape triggers onClose; otherwise Escape is ignored. */
  closeOnEscape?: boolean;
};

const layerClass = {
  normal: "z-[100]",
  critical: "z-[500]",
  alert: "z-[600]",
} as const;

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  children,
  onClose,
  labelledBy,
  layer = "normal",
  size = "normal",
  closeOnEscape = true,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const resolvedLabelId = labelledBy ?? titleId;
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusTarget =
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel?.querySelector<HTMLElement>("button,[href],input,select,textarea");
    focusTarget?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (closeOnEscape) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => !node.hasAttribute("disabled") && node.tabIndex !== -1,
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [closeOnEscape, mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${layerClass[layer]} grid place-items-center bg-slate-950/45 p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedLabelId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className={`flex max-h-[calc(100vh-2rem)] w-full ${size === "wide" ? "max-w-5xl" : "max-w-2xl"} flex-col overflow-hidden rounded-3xl bg-white shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id={resolvedLabelId} className="text-lg font-bold text-slate-900">
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
