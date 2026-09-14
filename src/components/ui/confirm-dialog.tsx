"use client";

import { Modal } from "@/components/ui/modal";
import { PrimaryButton, SecondaryButton } from "@/components/ui/page-shell";

export function ConfirmDialog({ title, message, confirmLabel = "确认", busy = false, tone = "default", onConfirm, onClose }: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onClose: () => void;
}) {
  return <Modal title={title} onClose={onClose} layer="critical">
    <p className="text-sm leading-6 text-slate-700">{message}</p>
    <div className="mt-5 flex justify-end gap-3">
      <SecondaryButton disabled={busy} onClick={onClose}>取消</SecondaryButton>
      <PrimaryButton className={tone === "danger" ? "!bg-rose-600" : ""} disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</PrimaryButton>
    </div>
  </Modal>;
}
