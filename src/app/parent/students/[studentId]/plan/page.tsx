"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  TextInput,
} from "@/components/ui/page-shell";
import { PointsTodayCard } from "@/components/m2/points-today-card";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createFormalPlan,
  deactivateFormalPlan,
  editFormalPlan,
  enablePointRule,
  fetchCurrentFormalPlan,
  fetchPointsLedger,
  fetchScheduleItems,
  maintainHorizon,
  scheduleStatusLabel,
  todayFamilyDate,
  type CurrentFormalPlanDto,
  type PointsLedgerEntryDto,
  type ScheduleItemDto,
} from "@/lib/client/m2-api";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";

export default function ParentPlanPage({ params }: { params: Promise<{ studentId: string }> }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [plan, setPlan] = useState<CurrentFormalPlanDto | null>(null);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItemDto[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<PointsLedgerEntryDto[]>([]);
  const [ruleEnabled, setRuleEnabled] = useState(false);

  const [createTitle, setCreateTitle] = useState("每天 20:00 完成作业");
  const [createLocalTime, setCreateLocalTime] = useState("20:00");
  const [createStartDate, setCreateStartDate] = useState(todayFamilyDate());
  const [createEndDate, setCreateEndDate] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editLocalTime, setEditLocalTime] = useState("20:00");
  const [editEndDate, setEditEndDate] = useState("");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [maintaining, setMaintaining] = useState(false);
  const [enablingRule, setEnablingRule] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadReadOnlyData = useCallback(async (sid: string) => {
    setError(null);
    setForbidden(false);
    const today = todayFamilyDate();
    const through = addFamilyDays(today, 7);

    try {
      const [planResult, scheduleResult, ledgerResult] = await Promise.all([
        fetchCurrentFormalPlan(sid),
        fetchScheduleItems(sid, today, through),
        fetchPointsLedger(sid, 5),
      ]);
      setPlan(planResult.plan);
      setScheduleItems(scheduleResult.items);
      setLedgerEntries(ledgerResult.entries);
      if (planResult.plan) {
        setEditTitle(planResult.plan.title);
        setEditLocalTime(planResult.plan.localTime ?? "20:00");
        setEditEndDate(planResult.plan.endDate ?? "");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const sid = resolved.studentId;
      setStudentId(sid);

      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }

      try {
        await loadReadOnlyData(sid);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadReadOnlyData, params, router]);

  async function onCreatePlan(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    setCreating(true);
    setActionMessage(null);
    setError(null);
    try {
      await createFormalPlan(studentId, {
        title: createTitle,
        localTime: createLocalTime,
        startDate: createStartDate,
        endDate: createEndDate.trim() ? createEndDate : null,
      });
      setActionMessage("计划已创建");
      await loadReadOnlyData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建计划失败");
    } finally {
      setCreating(false);
    }
  }

  async function onEditPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId || !plan) return;
    setEditing(true);
    setActionMessage(null);
    setError(null);
    try {
      await editFormalPlan(plan.planId, {
        title: editTitle,
        localTime: editLocalTime,
        endDate: editEndDate.trim() ? editEndDate : null,
      });
      setActionMessage("计划已更新");
      await loadReadOnlyData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新计划失败");
    } finally {
      setEditing(false);
    }
  }

  async function onDeactivatePlan() {
    if (!studentId || !plan) return;
    setDeactivating(true);
    setActionMessage(null);
    setError(null);
    try {
      await deactivateFormalPlan(plan.planId);
      setActionMessage("计划已停用");
      await loadReadOnlyData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "停用计划失败");
    } finally {
      setDeactivating(false);
    }
  }

  async function onMaintainHorizon() {
    if (!studentId) return;
    setMaintaining(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await maintainHorizon(studentId);
      setActionMessage(
        result.idempotentReplay
          ? "补齐日程已处理（幂等回放）"
          : `补齐日程完成，新增 ${result.itemsCreated} 项`,
      );
      await loadReadOnlyData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "补齐日程失败");
    } finally {
      setMaintaining(false);
    }
  }

  async function onEnablePointRule() {
    if (!studentId) return;
    setEnablingRule(true);
    setActionMessage(null);
    setError(null);
    try {
      await enablePointRule(studentId);
      setRuleEnabled(true);
      setActionMessage("固定积分规则已启用（完成 +10）");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRuleEnabled(true);
        setActionMessage("固定积分规则已启用");
      } else {
        setError(err instanceof ApiError ? err.message : "启用积分规则失败");
      }
    } finally {
      setEnablingRule(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="学习计划">
        <LoadingState />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell title="学习计划" backHref="/parent/students" showLogout>
        <Alert tone="error" data-testid="parent-forbidden">
          无权限访问该学生数据。
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell title="学习计划" subtitle="正式计划与积分" backHref="/parent/students" showLogout>
      {studentId ? <PointsTodayCard studentId={studentId} /> : null}

      {actionMessage ? (
        <Alert tone="success" data-testid="plan-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {plan ? (
        <section className="rounded-xl border border-neutral-300 bg-white p-4">
          <h2 className="text-sm font-semibold">当前计划</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">标题</dt>
              <dd className="text-right break-words">{plan.title}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">每日时间</dt>
              <dd>{plan.localTime ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">起止日期</dt>
              <dd className="text-right">
                {plan.startDate}
                {plan.endDate ? ` 至 ${plan.endDate}` : " 起"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">状态</dt>
              <dd>{plan.status === "active" ? "进行中" : plan.status}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section className="rounded-xl border border-neutral-300 bg-white p-4">
          <h2 className="text-sm font-semibold">创建正式计划</h2>
          <form className="mt-3 flex flex-col gap-4" onSubmit={onCreatePlan}>
            <Field label="标题">
              <TextInput
                data-testid="plan-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                required
              />
            </Field>
            <Field label="每日时间 (HH:MM)">
              <TextInput
                data-testid="plan-local-time"
                value={createLocalTime}
                onChange={(e) => setCreateLocalTime(e.target.value)}
                pattern="^\d{2}:\d{2}$"
                required
              />
            </Field>
            <Field label="开始日期">
              <TextInput
                data-testid="plan-start-date"
                type="date"
                value={createStartDate}
                onChange={(e) => setCreateStartDate(e.target.value)}
                required
              />
            </Field>
            <Field label="结束日期（可选）">
              <TextInput
                data-testid="plan-end-date"
                type="date"
                value={createEndDate}
                onChange={(e) => setCreateEndDate(e.target.value)}
              />
            </Field>
            <PrimaryButton type="submit" disabled={creating} data-testid="create-plan-button">
              {creating ? "创建中…" : "创建计划"}
            </PrimaryButton>
          </form>
        </section>
      )}

      {plan ? (
        <>
          <section className="rounded-xl border border-neutral-300 bg-white p-4">
            <h2 className="text-sm font-semibold">编辑计划</h2>
            <form className="mt-3 flex flex-col gap-4" onSubmit={onEditPlan}>
              <Field label="标题">
                <TextInput
                  data-testid="edit-plan-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </Field>
              <Field label="每日时间 (HH:MM)">
                <TextInput
                  data-testid="edit-plan-local-time"
                  value={editLocalTime}
                  onChange={(e) => setEditLocalTime(e.target.value)}
                  pattern="^\d{2}:\d{2}$"
                  required
                />
              </Field>
              <Field label="结束日期（可选）">
                <TextInput
                  data-testid="edit-plan-end-date"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                />
              </Field>
              <PrimaryButton type="submit" disabled={editing} data-testid="edit-plan-button">
                {editing ? "保存中…" : "保存修改"}
              </PrimaryButton>
            </form>
          </section>

          <section className="flex flex-col gap-3">
            <PrimaryButton
              disabled={enablingRule || ruleEnabled}
              onClick={() => void onEnablePointRule()}
              data-testid="enable-point-rule-button"
            >
              {ruleEnabled ? "积分规则已启用" : enablingRule ? "启用中…" : "启用固定积分规则 (+10)"}
            </PrimaryButton>
            <PrimaryButton
              disabled={maintaining}
              onClick={() => void onMaintainHorizon()}
              data-testid="maintain-horizon-button"
            >
              {maintaining ? "补齐中…" : "补齐日程"}
            </PrimaryButton>
            <PrimaryButton disabled={deactivating} onClick={() => void onDeactivatePlan()}>
              {deactivating ? "停用中…" : "停用计划"}
            </PrimaryButton>
          </section>
        </>
      ) : null}

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">近期日程</h2>
        {scheduleItems.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">暂无日程项</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {scheduleItems.map((item) => (
              <li
                key={item.id}
                data-testid={`schedule-item-${item.id}`}
                className="flex justify-between gap-3 text-sm"
              >
                <span className="break-words">
                  {item.familyDate}
                  {item.scheduledAt
                    ? ` ${new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        timeZone: "Asia/Shanghai",
                      })}`
                    : ""}
                </span>
                <span className="shrink-0">{scheduleStatusLabel(item.effectiveStatus)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">最近积分记录</h2>
        {ledgerEntries.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">暂无积分记录</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {ledgerEntries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3 text-sm">
                <span className="break-words">{entry.reason}</span>
                <span className="shrink-0 font-medium">
                  {entry.amount > 0 ? "+" : ""}
                  {entry.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
