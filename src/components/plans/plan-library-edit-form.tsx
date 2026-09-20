"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  appendPlanDraftEntry,
  blankPlanEntry,
  planFromDefinition,
  toPlanDefinition,
  validatePlanDraftEntries,
  type PlanDraftEntry,
} from "@/lib/plans/plan-draft-serialization";
import { Field, PrimaryButton, SecondaryButton, TextInput } from "@/components/ui/page-shell";
import { type PlanDefinitionDto, type PlanLibraryDto } from "@/lib/client/m2-api";

export {
  appendPlanDraftEntry,
  blankPlanEntry,
  planFromDefinition,
  toPlanDefinition,
  validatePlanDraftEntries,
  type PlanDraftEntry,
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (weekdays: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="选择星期">
      {WEEKDAY_LABELS.map((label, index) => {
        const day = index + 1;
        const selected = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={selected}
            className={`min-h-11 min-w-11 rounded-full border px-3 text-sm font-bold ${
              selected
                ? "border-[var(--bd-primary)] bg-[var(--bd-primary)] text-white"
                : "border-[var(--bd-border)] bg-[var(--bd-surface)]"
            }`}
            onClick={() =>
              onChange(
                selected ? value.filter((candidate) => candidate !== day) : [...value, day].sort(),
              )
            }
          >
            周{label}
          </button>
        );
      })}
    </div>
  );
}

type PlanLibraryEditFormProps = {
  plan: PlanLibraryDto;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (definition: PlanDefinitionDto, priority: number) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  bindingsSection?: ReactNode;
  submitLabel?: string;
  onValidationError?: (message: string) => void;
};

export function PlanLibraryEditForm({
  plan,
  saving,
  onCancel,
  onSubmit,
  onDirtyChange,
  bindingsSection,
  submitLabel = "保存修改",
  onValidationError,
}: PlanLibraryEditFormProps) {
  const [title, setTitle] = useState(plan.definition.title);
  const [description, setDescription] = useState(plan.definition.description ?? "");
  const planStartDateRef = useRef(plan.definition.startDate);
  const [priority, setPriority] = useState(String(plan.priority));
  const [entries, setEntries] = useState<PlanDraftEntry[]>(() =>
    planFromDefinition(plan.definition),
  );
  const dirtyNotified = useRef(false);

  useEffect(() => {
    planStartDateRef.current = plan.definition.startDate;
  }, [plan.definition.startDate]);

  function markDirty() {
    if (!dirtyNotified.current) {
      dirtyNotified.current = true;
      onDirtyChange?.(true);
    }
  }

  useEffect(() => {
    onDirtyChange?.(false);
    dirtyNotified.current = false;
  }, [plan.id, plan.revision, onDirtyChange]);

  function changeEntry<K extends keyof PlanDraftEntry>(
    index: number,
    key: K,
    value: PlanDraftEntry[K],
  ) {
    markDirty();
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry,
      ),
    );
  }

  function changePoints(index: number, pointIndex: number, value: string) {
    markDirty();
    setEntries((current) =>
      current.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const points = [...entry.points] as PlanDraftEntry["points"];
        points[pointIndex] = value;
        return { ...entry, points };
      }),
    );
  }

  const fieldsLocked = saving;

  return (
    <form
      className="bd-plan-edit max-w-3xl space-y-4 self-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        const validationError = validatePlanDraftEntries(entries);
        if (validationError) {
          onValidationError?.(validationError);
          return;
        }
        void onSubmit(
          toPlanDefinition(title, description, planStartDateRef.current, entries),
          Number(priority),
        );
      }}
    >
      <fieldset disabled={fieldsLocked} className="space-y-4 border-0 p-0 m-0 min-w-0">
      <section className="bd-panel space-y-3">
        <h2 className="text-lg font-black">基本信息</h2>
        <Field label="计划名称">
          <TextInput
            required
            value={title}
            onChange={(event) => {
              markDirty();
              setTitle(event.target.value);
            }}
          />
        </Field>
        <Field label="计划说明（可选）">
          <textarea
            maxLength={4000}
            className="min-h-24 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-3"
            value={description}
            onChange={(event) => {
              markDirty();
              setDescription(event.target.value);
            }}
          />
        </Field>
        <Field label="优先级">
          <TextInput
            required
            type="number"
            min="0"
            max="100"
            value={priority}
            onChange={(event) => {
              markDirty();
              setPriority(event.target.value);
            }}
          />
        </Field>
      </section>

      <section className="bd-panel space-y-3">
        <h2 className="text-lg font-black">任务内容</h2>
        {entries.map((entry, index) => (
          <fieldset
            className="space-y-3 rounded-2xl border border-[var(--bd-border)] p-3"
            key={entry.key || index}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="执行时间">
                <TextInput
                  required
                  type="time"
                  value={entry.expectedTime}
                  onChange={(event) => changeEntry(index, "expectedTime", event.target.value)}
                />
              </Field>
              <Field label="最晚开始（可选）">
                <TextInput
                  type="time"
                  value={entry.latestStartTime}
                  onChange={(event) => changeEntry(index, "latestStartTime", event.target.value)}
                />
              </Field>
            </div>
            <Field label="时长上限（分钟，可选）">
              <TextInput
                type="number"
                min="1"
                value={entry.durationMinutes}
                onChange={(event) => changeEntry(index, "durationMinutes", event.target.value)}
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
              <Field label="选择星期">
                <WeekdayPicker
                  value={entry.weeklyWeekdays}
                  onChange={(weekdays) => changeEntry(index, "weeklyWeekdays", weekdays)}
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
            <details className="rounded-xl border border-dashed border-[var(--bd-border)] p-3">
              <summary className="cursor-pointer font-bold">积分规则</summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {["按时且时长内", "按时超时", "迟开始且时长内", "迟开始超时", "未完成"].map(
                  (label, pointIndex) => (
                    <Field label={label} key={label}>
                      <TextInput
                        required
                        type="number"
                        value={entry.points[pointIndex]}
                        onChange={(event) => changePoints(index, pointIndex, event.target.value)}
                      />
                    </Field>
                  ),
                )}
              </div>
            </details>
            {entries.length > 1 ? (
              <SecondaryButton
                type="button"
                onClick={() => {
                  markDirty();
                  setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
                }}
              >
                删除内容
              </SecondaryButton>
            ) : null}
          </fieldset>
        ))}
        <SecondaryButton
          type="button"
          onClick={() => {
            markDirty();
            setEntries((current) => [...current, appendPlanDraftEntry(current)]);
          }}
        >
          添加内容
        </SecondaryButton>
      </section>

      {bindingsSection ? (
        <section className="bd-panel space-y-3">
          <h2 className="text-lg font-black">适用对象</h2>
          {bindingsSection}
        </section>
      ) : null}

      </fieldset>

      <div className="bd-plan-edit-footer flex flex-col gap-3 sm:flex-row sm:justify-end">
        <SecondaryButton type="button" onClick={onCancel} className="w-full sm:w-auto">
          取消
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving} data-testid="plan-edit-save" fullWidth={false}>
          {saving ? "保存中…" : submitLabel}
        </PrimaryButton>
      </div>
    </form>
  );
}
