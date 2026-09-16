"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Modal } from "@/components/ui/modal";
import { Field, LoadingState, PageShell, PrimaryButton, SecondaryButton, TextInput, Toast } from "@/components/ui/page-shell";
import { StudentManagementTabs } from "@/components/ui/student-management-tabs";
import { StudentMultiSelect } from "@/components/ui/student-multi-select";
import { ApiError, fetchSession, type SessionInfo } from "@/lib/client/api";
import {
  approveGoal,
  addGoalNote,
  createGoals,
  createManualPenalty,
  evaluateGoal,
  recordGoalGiftRedemption,
  fetchGoals,
  fetchLinkedStudents,
  fetchManualPenalties,
  fetchPointsBalance,
  reverseManualPenalty,
  updateGoal,
  type GoalDto,
  type LinkedStudentDto,
  type ManualPointAdjustmentDto,
} from "@/lib/client/m2-api";

const horizonLabel = { short: "近期", medium: "中期", long: "远期" } as const;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const goalStatus: Record<GoalDto["status"], string> = {
  pending_approval: "待家长审批",
  active: "进行中",
  succeeded: "已达成",
  failed: "未达成",
};

function ParentGoalsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selfOnly = searchParams.get("scope") === "self";
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalDto | null>(null);
  const [notingGoal, setNotingGoal] = useState<GoalDto | null>(null);
  const [postNote, setPostNote] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [expectedPoints, setExpectedPoints] = useState("");
  const [expectedGift, setExpectedGift] = useState("");
  const [notes, setNotes] = useState("");
  const [horizon, setHorizon] = useState<"short" | "medium" | "long">("medium");
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [redeemedAtInput, setRedeemedAtInput] = useState("");
  const [evaluating, setEvaluating] = useState<GoalDto | null>(null);
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("succeeded");
  const [actualPoints, setActualPoints] = useState("0");
  const [actualGift, setActualGift] = useState("");
  const [evaluationReason, setEvaluationReason] = useState("");
  const [penaltyStudentId, setPenaltyStudentId] = useState("");
  const [penaltyPoints, setPenaltyPoints] = useState("");
  const [penaltyReason, setPenaltyReason] = useState("");
  const [penaltyBalance, setPenaltyBalance] = useState(0);
  const [penalties, setPenalties] = useState<ManualPointAdjustmentDto[]>([]);
  const [confirmPenalty, setConfirmPenalty] = useState(false);
  const [reversing, setReversing] = useState<ManualPointAdjustmentDto | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [goalResult, studentResult] = await Promise.all([fetchGoals(), fetchLinkedStudents()]);
    setGoals(goalResult.goals);
    setStudents(studentResult.students);
  }, []);

  useEffect(() => {
    void (async () => {
      const current = await fetchSession();
      if (!current || current.role !== "parent") return router.replace("/login");
      setSession(current);
      try { await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "无法加载目标"); }
      finally { setLoading(false); }
    })();
  }, [load, router]);

  const selectOptions = session
    ? [{ studentId: session.userId, displayName: `${session.displayName || session.account || "我"}（我的个人目标）`, username: session.account ?? null }, ...students]
    : students;
  const visibleGoals = selfOnly && session ? goals.filter((item) => item.subjectId === session.userId) : goals;

  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (editingGoal) await updateGoal(editingGoal.assignmentId, { revision: editingGoal.revision, content, dueDate, expectedPoints: expectedPoints ? Number(expectedPoints) : null, expectedGift: expectedGift || null, notes: notes || null, horizon });
      else await createGoals({ subjectIds, content, dueDate, expectedPoints: expectedPoints ? Number(expectedPoints) : null, expectedGift: expectedGift || null, notes: notes || null, horizon });
      setFormOpen(false); setEditingGoal(null); setSubjectIds([]); setContent(""); setExpectedPoints(""); setExpectedGift(""); setNotes(""); setHorizon("medium");
      setMessage(editingGoal ? "目标已更新" : "目标已生效"); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "目标保存失败"); }
    finally { setBusy(false); }
  }

  function openGoalEdit(item: GoalDto) {
    setEditingGoal(item); setSubjectIds([item.subjectId]); setContent(item.content); setDueDate(item.dueDate);
    setExpectedPoints(item.expectedPoints === null ? "" : String(item.expectedPoints)); setExpectedGift(item.expectedGift ?? ""); setNotes(item.notes ?? ""); setHorizon(item.horizon); setFormOpen(true);
  }

  async function savePostNote() {
    if (!notingGoal || !postNote.trim()) return;
    setBusy(true);
    try { await addGoalNote(notingGoal.assignmentId, postNote.trim()); setNotingGoal(null); setPostNote(""); setMessage("补充说明已追加"); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "补充说明保存失败"); }
    finally { setBusy(false); }
  }

  async function approve(item: GoalDto) {
    setBusy(true);
    try { await approveGoal(item.assignmentId); setMessage("目标已批准并生效"); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "目标批准失败"); }
    finally { setBusy(false); }
  }

  async function submitEvaluation() {
    if (!evaluating) return;
    setBusy(true);
    try {
      await evaluateGoal(evaluating.assignmentId, { outcome, actualPoints: Number(actualPoints || 0), actualGift: actualGift || null, reason: evaluationReason || null });
      setEvaluating(null); setMessage("目标评定已记录"); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "目标评定失败"); }
    finally { setBusy(false); }
  }

  async function loadPenaltyStudent(studentId: string) {
    setPenaltyStudentId(studentId);
    if (!studentId) { setPenalties([]); setPenaltyBalance(0); return; }
    try {
      const [balance, history] = await Promise.all([fetchPointsBalance(studentId), fetchManualPenalties(studentId)]);
      setPenaltyBalance(balance.balance); setPenalties(history.adjustments);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "无法加载奖惩记录"); }
  }

  async function applyPenalty() {
    setBusy(true);
    try {
      await createManualPenalty(penaltyStudentId, Number(penaltyPoints), penaltyReason);
      setConfirmPenalty(false); setPenaltyPoints(""); setPenaltyReason(""); setMessage("扣分已记录"); await loadPenaltyStudent(penaltyStudentId);
    } catch (cause) { setConfirmPenalty(false); setError(cause instanceof ApiError ? cause.message : "扣分失败"); }
    finally { setBusy(false); }
  }

  async function applyReversal() {
    if (!reversing) return;
    setBusy(true);
    try {
      await reverseManualPenalty(reversing.studentId, reversing.id, reverseReason);
      setReversing(null); setReverseReason(""); setMessage("扣分已全额撤销"); await loadPenaltyStudent(penaltyStudentId);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "撤销失败"); }
    finally { setBusy(false); }
  }

  if (loading) return <PageShell title="目标"><LoadingState /></PageShell>;
  return <PageShell title="目标" hideHeading showLogout backHref={selfOnly ? "/account" : "/parent/students"} secondaryNavigation={selfOnly ? undefined : <StudentManagementTabs />}>
    <ErrorDialog message={error} onClose={() => setError(null)} />
    <Toast message={message} onClose={() => setMessage(null)} />
    <section className="bd-library-toolbar">
      <div className="bd-library-toolbar-copy"><h2>{selfOnly ? "我的个人目标" : "目标中心"}</h2><p>{selfOnly ? "只记录个人执行，不产生学生积分或礼物。" : "学生提案需审批；正式目标由责任家长评定。"}</p></div>
      <PrimaryButton fullWidth={false} onClick={() => { setEditingGoal(null); setContent(""); setDueDate(today()); setExpectedPoints(""); setExpectedGift(""); setNotes(""); setSubjectIds(selfOnly && session ? [session.userId] : []); setFormOpen(true); }}>新增目标</PrimaryButton>
    </section>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
      <section className="bd-panel">
        <h2 className="mb-3 text-lg font-bold">最近目标</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleGoals.map((item) => <article key={item.assignmentId} className="rounded-3xl border border-[var(--bd-border)] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><strong className="break-words">{item.content}</strong><span className="bd-chip">{goalStatus[item.status]}</span></div>
            <p className="mt-2 text-sm text-slate-600">{item.subjectName} · {horizonLabel[item.horizon]} · 截止 {item.dueDate}</p>
            <p className="mt-2 text-sm">期望：{item.expectedPoints ?? 0} 积分{item.expectedGift ? ` + ${item.expectedGift}` : ""}</p>
            {item.notes ? <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{item.notes}</p> : null}
            {item.responsibleParentName ? <p className="mt-2 text-xs text-slate-500">责任家长：{item.responsibleParentName}</p> : null}
            {item.canApprove ? <PrimaryButton className="mt-3" disabled={busy} onClick={() => void approve(item)}>批准生效</PrimaryButton> : null}
            {item.canRecordGiftRedemption ? <div className="mt-3 space-y-2 rounded-2xl bg-amber-50 p-3 text-sm"><p>实际礼物：{item.actualGift}（尚未兑现）</p><label className="block">兑现时间<input className="mt-1 min-h-11 w-full rounded-2xl border p-2" type="datetime-local" value={redeemingId === item.assignmentId ? redeemedAtInput : ""} onChange={(event) => { setRedeemingId(item.assignmentId); setRedeemedAtInput(event.target.value); }} /></label><PrimaryButton type="button" fullWidth={false} disabled={busy || redeemingId !== item.assignmentId || !redeemedAtInput} onClick={() => void (async () => { setBusy(true); setError(null); try { await recordGoalGiftRedemption(item.assignmentId, new Date(redeemedAtInput).toISOString()); setMessage("已记录礼物兑现"); setRedeemingId(null); setRedeemedAtInput(""); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "记录兑现失败"); } finally { setBusy(false); } })()}>记录礼物兑现</PrimaryButton></div> : item.giftRedeemedAt ? <p className="mt-2 text-sm text-emerald-700">礼物已兑现：{new Date(item.giftRedeemedAt).toLocaleString("zh-CN")}</p> : null}
            {(item.canEdit || item.canEvaluate || item.canAddNote) ? <div className="mt-3 flex flex-wrap gap-2">{item.canEdit ? <SecondaryButton onClick={() => openGoalEdit(item)}>编辑目标</SecondaryButton> : null}{item.canEvaluate ? <SecondaryButton onClick={() => { setEvaluating(item); setOutcome("succeeded"); setActualPoints(String(item.expectedPoints ?? 0)); setActualGift(item.expectedGift ?? ""); setEvaluationReason(""); }}>评定目标</SecondaryButton> : null}{item.canAddNote ? <SecondaryButton onClick={() => { setNotingGoal(item); setPostNote(""); }}>补充说明</SecondaryButton> : null}</div> : null}
            {item.status === "succeeded" || item.status === "failed" ? <p className="mt-3 text-sm font-semibold">最终：{item.status === "succeeded" ? "成功" : "失败"} · {item.actualPoints ?? 0} 分{item.actualGift ? ` · ${item.actualGift}` : ""}</p> : null}
            {item.postNotes.length ? <div className="mt-3 space-y-2 border-t border-[var(--bd-border)] pt-3"><strong className="text-sm">补充说明</strong>{item.postNotes.map((note) => <p key={note.id} className="rounded-2xl bg-slate-50 p-3 text-sm"><span className="font-semibold">{note.authorName}</span>：{note.body}<time className="ml-2 text-xs text-slate-500">{new Date(note.createdAt).toLocaleString("zh-CN")}</time></p>)}</div> : null}
          </article>)}
          {!visibleGoals.length ? <p className="text-sm text-slate-500">暂无目标。</p> : null}
        </div>
      </section>
      {!selfOnly ? <section className="bd-panel">
        <h2 className="text-lg font-bold">积分惩罚</h2>
        <p className="mt-1 text-sm text-slate-600">独立记录，不与目标失败自动绑定。</p>
        <select className="mt-3 min-h-11 w-full rounded-2xl border p-2" value={penaltyStudentId} onChange={(event) => void loadPenaltyStudent(event.target.value)}>
          <option value="">选择学生</option>{students.map((student) => <option key={student.studentId} value={student.studentId}>{student.displayName || student.username}</option>)}
        </select>
        {penaltyStudentId ? <>
          <p className="mt-3 font-semibold">当前余额：{penaltyBalance}</p>
          <Field label="扣除积分"><TextInput type="number" min={1} max={penaltyBalance} value={penaltyPoints} onChange={(event) => setPenaltyPoints(event.target.value)} /></Field>
          <Field label="原因（2–200 字）"><textarea className="min-h-24 w-full rounded-2xl border p-3" value={penaltyReason} onChange={(event) => setPenaltyReason(event.target.value)} /></Field>
          <PrimaryButton disabled={!penaltyPoints || penaltyReason.trim().length < 2 || Number(penaltyPoints) > penaltyBalance} onClick={() => setConfirmPenalty(true)}>确认扣分</PrimaryButton>
          <div className="mt-4 space-y-2">{penalties.map((item) => <div key={item.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between gap-3"><strong className={item.amount < 0 ? "text-rose-600" : "text-emerald-600"}>{item.amount > 0 ? "+" : ""}{item.amount}</strong><span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span></div>
            <p>{item.actorName}：{item.reason}</p>{item.canReverse ? <button className="mt-2 text-[var(--bd-primary)] underline" onClick={() => setReversing(item)}>全额撤销</button> : null}
          </div>)}</div>
        </> : null}
      </section> : null}
    </div>
    {formOpen ? <Modal title={editingGoal ? "编辑目标" : "新增目标"} onClose={() => { setFormOpen(false); setEditingGoal(null); }}><form className="space-y-3" onSubmit={saveGoal}>
      {editingGoal ? <p className="rounded-2xl bg-slate-50 p-3 text-sm">目标对象：<strong>{editingGoal.subjectName}</strong>{goals.filter((goal) => goal.definitionId === editingGoal.definitionId).length > 1 ? "（修改会同步到同批目标）" : ""}</p> : <Field label="目标对象（可多选）"><StudentMultiSelect students={selfOnly ? selectOptions.slice(0, 1) : selectOptions} selectedIds={subjectIds} onChange={setSubjectIds} emptyLabel="选择学生或自己" /></Field>}
      <Field label="目标内容"><textarea required maxLength={500} className="min-h-28 w-full rounded-2xl border p-3" value={content} onChange={(event) => setContent(event.target.value)} /></Field>
      <Field label="期限"><select className="min-h-11 w-full rounded-2xl border p-2" value={horizon} onChange={(event) => setHorizon(event.target.value as "short" | "medium" | "long")}><option value="short">近期</option><option value="medium">中期</option><option value="long">远期</option></select></Field>
        <Field label="完成日期"><TextInput required type="date" min={today()} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
      <Field label="期望积分（可选）"><TextInput type="number" min={0} value={expectedPoints} onChange={(event) => setExpectedPoints(event.target.value)} /></Field>
      <Field label="期望礼物（可选）"><TextInput value={expectedGift} onChange={(event) => setExpectedGift(event.target.value)} /></Field>
      <Field label="备注（可选）"><textarea className="min-h-20 w-full rounded-2xl border p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      <PrimaryButton type="submit" disabled={busy || (!editingGoal && !subjectIds.length)}>{busy ? "保存中…" : editingGoal ? "保存修改" : "保存并生效"}</PrimaryButton>
    </form></Modal> : null}
    {notingGoal ? <Modal title="追加评定说明" layer="critical" onClose={() => setNotingGoal(null)}><p className="mb-3 text-sm font-semibold">{notingGoal.subjectName} · {notingGoal.content}</p><Field label="补充说明（保存后不可删除）"><textarea maxLength={1000} className="min-h-28 w-full rounded-2xl border p-3" value={postNote} onChange={(event) => setPostNote(event.target.value)} /></Field><div className="mt-4 flex justify-end gap-2"><SecondaryButton onClick={() => setNotingGoal(null)}>取消</SecondaryButton><PrimaryButton disabled={busy || !postNote.trim()} onClick={() => void savePostNote()}>追加说明</PrimaryButton></div></Modal> : null}
    {evaluating ? <Modal title="评定目标" onClose={() => setEvaluating(null)}>
      <div className="space-y-3"><p className="font-semibold">{evaluating.subjectName} · {evaluating.content}</p>
        <Field label="结果"><select className="min-h-11 w-full rounded-2xl border p-2" value={outcome} onChange={(event) => setOutcome(event.target.value as "succeeded" | "failed")}><option value="succeeded">成功</option><option value="failed">失败</option></select></Field>
        <Field label="最终积分"><TextInput type="number" min={0} disabled={outcome === "failed" || evaluating.isPersonal} value={outcome === "failed" || evaluating.isPersonal ? "0" : actualPoints} onChange={(event) => setActualPoints(event.target.value)} /></Field>
        <Field label="最终礼物"><TextInput disabled={outcome === "failed" || evaluating.isPersonal} value={outcome === "failed" || evaluating.isPersonal ? "" : actualGift} onChange={(event) => setActualGift(event.target.value)} /></Field>
        <Field label="说明（奖励变化时必填）"><textarea className="min-h-20 w-full rounded-2xl border p-3" value={evaluationReason} onChange={(event) => setEvaluationReason(event.target.value)} /></Field>
        <PrimaryButton disabled={busy} onClick={() => void submitEvaluation()}>确认评定</PrimaryButton>
      </div>
    </Modal> : null}
    {confirmPenalty ? <ConfirmDialog title="确认惩罚扣分" tone="danger" busy={busy} message={`将从当前余额 ${penaltyBalance} 分中扣除 ${penaltyPoints} 分。原因：${penaltyReason}`} confirmLabel="确认扣分" onClose={() => setConfirmPenalty(false)} onConfirm={() => void applyPenalty()} /> : null}
    {reversing ? <Modal title="全额撤销扣分" layer="critical" onClose={() => setReversing(null)}><Field label="撤销原因（2–200 字）"><textarea className="min-h-24 w-full rounded-2xl border p-3" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></Field><div className="mt-4 flex justify-end gap-2"><SecondaryButton onClick={() => setReversing(null)}>取消</SecondaryButton><PrimaryButton disabled={busy || reverseReason.trim().length < 2} onClick={() => void applyReversal()}>确认全额撤销</PrimaryButton></div></Modal> : null}
  </PageShell>;
}

export default function ParentGoalsPage() {
  return (
    <Suspense fallback={<PageShell title="目标"><LoadingState /></PageShell>}>
      <ParentGoalsPageContent />
    </Suspense>
  );
}
