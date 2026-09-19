"use client";

import { useState } from "react";

import { Field, PrimaryButton, SecondaryButton, TextInput } from "@/components/ui/page-shell";
import { type PlanDefinitionDto, type PlanLibraryDto } from "@/lib/client/m2-api";

export type PlanDraftEntry = {
  title: string;
  description: string;
  expectedTime: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  repeatValue: string;
};

export const blankPlanEntry = (): PlanDraftEntry => ({
  title: "",
  description: "",
  expectedTime: "19:00",
  repeat: "daily",
  repeatValue: "",
});

export function planFromDefinition(plan: PlanDefinitionDto): PlanDraftEntry[] {
  return plan.entries.map((entry) => ({
    title: entry.title,
    description: entry.description ?? "",
    expectedTime: entry.expectedTime,
    repeat: entry.repeat.kind as PlanDraftEntry["repeat"],
    repeatValue:
      entry.repeat.kind === "once"
        ? (entry.repeat.date ?? "")
        : entry.repeat.kind === "weekly"
          ? (entry.repeat.weekdays?.join(",") ?? "")
          : entry.repeat.kind === "monthly"
            ? (entry.repeat.days?.join(",") ?? "")
            : "",
  }));
}

export function toPlanDefinition(
  title: string,
  description: string,
  startDate: string,
  entries: PlanDraftEntry[],
): PlanDefinitionDto {
  return {
    title,
    description: description.trim() || undefined,
    startDate,
    entries: entries.map((entry, index) => ({
      key: `item-${index + 1}`,
      title: entry.title,
      description: entry.description.trim() || undefined,
      expectedTime: entry.expectedTime,
      latestStartTime: null,
      durationMinutes: null,
      repeat:
        entry.repeat === "once"
          ? { kind: "once", date: entry.repeatValue || startDate }
          : entry.repeat === "weekly"
            ? {
                kind: "weekly",
                weekdays: entry.repeatValue
                  .split(",")
                  .map(Number)
                  .filter((value) => value >= 1 && value <= 7),
              }
            : entry.repeat === "monthly"
              ? {
                  kind: "monthly",
                  days: entry.repeatValue
                    .split(",")
                    .map(Number)
                    .filter((value) => value >= 1 && value <= 31),
                }
              : { kind: "daily" },
      points: { onTimeWithin: 0, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
    })),
  };
}

type PlanLibraryEditFormProps = {
  plan: PlanLibraryDto;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (definition: PlanDefinitionDto, priority: number) => void | Promise<void>;
};

export function PlanLibraryEditForm({
  plan,
  saving,
  onCancel,
  onSubmit,
}: PlanLibraryEditFormProps) {
  const [title, setTitle] = useState(plan.definition.title);
  const [description, setDescription] = useState(plan.definition.description ?? "");
  const [startDate, setStartDate] = useState(plan.definition.startDate);
  const [priority, setPriority] = useState(String(plan.priority));
  const [entries, setEntries] = useState<PlanDraftEntry[]>(() =>
    planFromDefinition(plan.definition),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function changeEntry<K extends keyof PlanDraftEntry>(
    index: number,
    key: K,
    value: PlanDraftEntry[K],
  ) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry,
      ),
    );
  }

  return (
    <form
      className="bd-plan-edit max-w-3xl space-y-4 self-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(toPlanDefinition(title, description, startDate, entries), Number(priority));
      }}
    >
      <section className="bd-panel space-y-3">
        <h2 className="text-lg font-black">基本信息</h2>
        <Field label="计划名称">
          <TextInput required value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="计划说明（可选）">
          <textarea
            maxLength={4000}
            className="min-h-24 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-3"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </section>

      <section className="bd-panel space-y-3">
        <h2 className="text-lg font-black">任务内容</h2>
        {entries.map((entry, index) => (
          <fieldset
            className="space-y-3 rounded-2xl border border-[var(--bd-border)] p-3"
            key={index}
          >
            <legend className="font-bold">内容 {index + 1}</legend>
            <Field label="内容名称">
              <TextInput
                required
                value={entry.title}
                onChange={(event) => changeEntry(index, "title", event.target.value)}
              />
            </Field>
            <Field label="内容说明（可选）">
              <textarea
                maxLength={500}
                className="min-h-20 w-full rounded-2xl border border-[var(--bd-border)] p-3"
                value={entry.description}
                onChange={(event) => changeEntry(index, "description", event.target.value)}
              />
            </Field>
            <Field label="执行时间">
              <TextInput
                required
                type="time"
                value={entry.expectedTime}
                onChange={(event) => changeEntry(index, "expectedTime", event.target.value)}
              />
            </Field>
            <Field label="重复方式">
              <select
                className="min-h-11 w-full rounded-2xl border border-[var(--bd-border)] p-2"
                value={entry.repeat}
                onChange={(event) =>
                  changeEntry(index, "repeat", event.target.value as PlanDraftEntry["repeat"])
                }
              >
                <option value="once">某天</option>
                <option value="daily">每天</option>
                <option value="weekly">每周星期几</option>
                <option value="monthly">每月几号</option>
              </select>
            </Field>
            {entry.repeat === "weekly" ? (
              <Field label="星期（1=周一 … 7=周日，逗号分隔）">
                <TextInput
                  required
                  value={entry.repeatValue}
                  onChange={(event) => changeEntry(index, "repeatValue", event.target.value)}
                />
              </Field>
            ) : null}
            {entry.repeat === "monthly" ? (
              <Field label="日期（逗号分隔）">
                <TextInput
                  required
                  value={entry.repeatValue}
                  onChange={(event) => changeEntry(index, "repeatValue", event.target.value)}
                />
              </Field>
            ) : null}
            {entry.repeat === "once" ? (
              <Field label="日期">
                <TextInput
                  required
                  type="date"
                  value={entry.repeatValue}
                  onChange={(event) => changeEntry(index, "repeatValue", event.target.value)}
                />
              </Field>
            ) : null}
            {entries.length > 1 ? (
              <SecondaryButton
                type="button"
                onClick={() =>
                  setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))
                }
              >
                删除内容
              </SecondaryButton>
            ) : null}
          </fieldset>
        ))}
        <SecondaryButton
          type="button"
          onClick={() => setEntries((current) => [...current, blankPlanEntry()])}
        >
          添加内容
        </SecondaryButton>
      </section>

      <details
        className="bd-panel"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-lg font-black">高级设置</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="开始日期">
            <TextInput
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label="优先级">
            <TextInput
              required
              type="number"
              min="0"
              max="100"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </Field>
        </div>
      </details>

      <div className="bd-plan-edit-actions sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-wrap gap-3 rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-3 shadow-lg">
        <SecondaryButton type="button" onClick={onCancel}>
          取消
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving} data-testid="plan-edit-save">
          {saving ? "保存中…" : "保存修改"}
        </PrimaryButton>
      </div>
    </form>
  );
}
