"use client";
import { PrimaryButton } from "@/components/ui/page-shell";
import { Modal } from "@/components/ui/modal";
export function ErrorDialog({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <Modal title="操作失败" onClose={onClose} labelledBy="error-dialog-title" layer="critical">
      <p className="whitespace-pre-wrap text-sm text-slate-700">{message}</p>
      <PrimaryButton className="mt-5 w-full" onClick={onClose}>
        知道了
      </PrimaryButton>
    </Modal>
  );
}
