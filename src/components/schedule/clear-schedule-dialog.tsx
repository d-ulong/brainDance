"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import { PrimaryButton, SecondaryButton } from "@/components/ui/page-shell";
import { todayFamilyDate } from "@/lib/client/m2-api";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function ClearScheduleDialog({ busy, studentLimited, onClose, onConfirm }: {
  busy: boolean;
  studentLimited: boolean;
  onClose: () => void;
  onConfirm: (from: string, through: string) => void;
}) {
  const today = todayFamilyDate();
  const [from, setFrom] = useState(today);
  const [through, setThrough] = useState(addDays(today, 13));
  const latest = addDays(today, 89);
  const maxThrough = addDays(from, 89) < latest ? addDays(from, 89) : latest;
  return <Modal title="清除未来日程" onClose={onClose} layer="critical">
    <p className="rounded-2xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
      只会取消所选范围内尚未开始的任务；进行中和已完成任务会保留。{studentLimited ? "你只能清除由自己计划生成的日程。" : "家长可清除该学生全部未开始日程。"}
    </p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-semibold">开始日期<input type="date" min={today} max={latest} value={from} onChange={(event) => { const next = event.target.value; setFrom(next); const nextMax = addDays(next, 89) < latest ? addDays(next, 89) : latest; if (through < next || through > nextMax) setThrough(next); }} /></label>
      <label className="grid gap-2 text-sm font-semibold">结束日期<input type="date" min={from} max={maxThrough} value={through} onChange={(event) => setThrough(event.target.value)} /></label>
    </div>
    <div className="mt-5 flex justify-end gap-3"><SecondaryButton disabled={busy} onClick={onClose}>取消</SecondaryButton><PrimaryButton className="!bg-rose-600" disabled={busy || from < today || through < from || through > maxThrough} onClick={() => onConfirm(from, through)}>{busy ? "清除中…" : "确认清除"}</PrimaryButton></div>
  </Modal>;
}
