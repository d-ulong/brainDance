"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorDialog } from "@/components/ui/error-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { StudentManagementTabs } from "@/components/ui/student-management-tabs";
import { Field, LoadingState, PageShell, PrimaryButton, SecondaryButton, TextInput } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession } from "@/lib/client/api";
import { approveRedemption, createCatalogItem, fetchRedemptionCatalog, fetchRedemptions, redemptionStatusLabel, rejectRedemption, updateCatalogItem, type CatalogItemDto, type RedemptionDto } from "@/lib/client/m6-api";

type LinkedStudent = { studentId: string; displayName: string; username: string | null };
type CatalogRow = CatalogItemDto & { student: LinkedStudent };
type RecordRow = RedemptionDto & { student: LinkedStudent };
type CatalogEditor = { item: CatalogRow | null; studentId: string };
const studentLabel = (student: LinkedStudent) => student.displayName || student.username || "未命名学生";
const dayOf = (value: string) => value.slice(0, 10);

export default function ParentRedemptionHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<LinkedStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [studentFilter, setStudentFilter] = useState("");
  const [catalogFilter, setCatalogFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [throughDate, setThroughDate] = useState("");
  const [editor, setEditor] = useState<CatalogEditor | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("20");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirming, setConfirming] = useState<{ kind: "approve"; record: RecordRow } | { kind: "toggle"; item: CatalogRow } | null>(null);

  const load = useCallback(async () => {
    const linked = (await apiFetch<{ students: LinkedStudent[] }>("/api/family/students")).students;
    const loaded = await Promise.all(linked.map(async (student) => {
      const [catalogResult, recordResult] = await Promise.all([fetchRedemptionCatalog(student.studentId), fetchRedemptions(student.studentId)]);
      return { catalog: catalogResult.items.map((item) => ({ ...item, student })), records: recordResult.redemptions.map((record) => ({ ...record, student })) };
    }));
    setStudents(linked);
    setCatalog(loaded.flatMap((item) => item.catalog));
    setRecords(loaded.flatMap((item) => item.records));
  }, []);

  useEffect(() => { void (async () => {
    const session = await fetchSession();
    if (!session || session.role !== "parent") return router.replace("/login");
    try { await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "无法加载兑换项目"); } finally { setLoading(false); }
  })(); }, [load, router]);

  const visibleCatalog = catalog;
  const visibleRecords = useMemo(() => records.filter((record) =>
    (!studentFilter || record.studentId === studentFilter) && (!catalogFilter || record.catalogItemId === catalogFilter) &&
    (!fromDate || dayOf(record.requestedAt) >= fromDate) && (!throughDate || dayOf(record.requestedAt) <= throughDate),
  ), [records, studentFilter, catalogFilter, fromDate, throughDate]);

  function openEditor(item: CatalogRow | null = null) {
    const defaultStudent = item?.studentId || studentFilter || students[0]?.studentId || "";
    setEditor({ item, studentId: defaultStudent }); setTitle(item?.title ?? ""); setDescription(item?.description ?? "");
    setCost(item ? String(item.cost) : "20"); setMonthlyLimit(item?.monthlyLimit === null || !item ? "" : String(item.monthlyLimit));
  }
  async function saveCatalog(event: React.FormEvent) {
    event.preventDefault(); if (!editor || !title.trim()) return; setSaving(true);
    try {
      const values = { title: title.trim(), description: description.trim() || null, cost: Number(cost), monthlyLimit: monthlyLimit ? Number(monthlyLimit) : null };
      if (editor.item) { await updateCatalogItem(editor.item.studentId, editor.item.id, values); setNotice("兑换项目已更新"); }
      else { await createCatalogItem(editor.studentId, values); setNotice("兑换项目已新增"); }
      setEditor(null); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "保存兑换项目失败"); } finally { setSaving(false); }
  }
  async function toggleItem(item: CatalogRow) {
    try { await updateCatalogItem(item.studentId, item.id, { active: !item.active }); setNotice(item.active ? "兑换项目已停用" : "兑换项目已启用"); setConfirming(null); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "变更兑换项目失败"); }
  }
  async function approve(record: RecordRow) {
    try { await approveRedemption(record.studentId, record.id); setNotice("兑换申请已批准"); setConfirming(null); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "批准兑换失败"); }
  }
  async function reject(record: RecordRow) {
    if (!rejectReason.trim()) return setError("请填写拒绝理由");
    try { await rejectRedemption(record.studentId, record.id, rejectReason.trim()); setRejectingId(null); setRejectReason(""); setNotice("兑换申请已拒绝"); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "拒绝兑换失败"); }
  }

  if (loading) return <PageShell title="兑换项目"><LoadingState /></PageShell>;
  return <PageShell title="兑换项目" subtitle="在这里管理项目并处理学生的兑换申请" backHref="/parent/students" showLogout hideHeading secondaryNavigation={<StudentManagementTabs />}>
    <ErrorDialog message={error} onClose={() => setError(null)} />
    {confirming?.kind === "approve" ? <ConfirmDialog title="确认批准兑换" message={`批准后将从 ${studentLabel(confirming.record.student)} 的积分中扣除 ${confirming.record.costSnapshot} 分，确定继续吗？`} confirmLabel="批准并扣分" onClose={() => setConfirming(null)} onConfirm={() => void approve(confirming.record)} /> : null}
    {confirming?.kind === "toggle" ? <ConfirmDialog title={confirming.item.active ? "停用兑换项目" : "启用兑换项目"} message={confirming.item.active ? `停用“${confirming.item.title}”后，学生将不能再申请该项目。` : `启用“${confirming.item.title}”后，所有关联学生都可以看到并申请。`} confirmLabel={confirming.item.active ? "确认停用" : "确认启用"} tone={confirming.item.active ? "danger" : "default"} onClose={() => setConfirming(null)} onConfirm={() => void toggleItem(confirming.item)} /> : null}
    {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {!students.length ? <p className="rounded-2xl border bg-white p-4 text-sm text-neutral-600">请先创建或关联学生，再设置兑换项目。</p> : <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-3xl border border-[var(--bd-border)] bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold">兑换记录</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select className="min-h-11 rounded-2xl border p-2" value={studentFilter} onChange={(event) => { setStudentFilter(event.target.value); setCatalogFilter(""); }}><option value="">全部学生</option>{students.map((student) => <option key={student.studentId} value={student.studentId}>{studentLabel(student)}</option>)}</select>
          <select className="min-h-11 rounded-2xl border p-2" value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value)}><option value="">全部项目</option>{visibleCatalog.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <TextInput type="date" aria-label="开始日期" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <TextInput type="date" aria-label="结束日期" value={throughDate} onChange={(event) => setThroughDate(event.target.value)} />
        </div>
        {visibleRecords.length ? <ul className="mt-4 space-y-3">{visibleRecords.map((record) => {
          const item = catalog.find((candidate) => candidate.id === record.catalogItemId);
          return <li key={record.id} className="rounded-2xl border border-neutral-200 p-3 text-sm"><p className="font-semibold">{item?.title || "已删除兑换项目"}</p><p className="mt-1 text-neutral-600">{studentLabel(record.student)} · {redemptionStatusLabel(record.status)} · {record.costSnapshot} 积分</p>{record.status === "pending" ? <div className="mt-3 flex flex-wrap gap-2"><SecondaryButton onClick={() => setConfirming({ kind: "approve", record })}>批准</SecondaryButton><SecondaryButton onClick={() => { setRejectingId(record.id); setRejectReason(""); }}>拒绝</SecondaryButton></div> : null}{rejectingId === record.id ? <div className="mt-3 flex gap-2"><TextInput value={rejectReason} placeholder="拒绝理由" onChange={(event) => setRejectReason(event.target.value)} /><PrimaryButton fullWidth={false} onClick={() => void reject(record)}>确认拒绝</PrimaryButton></div> : null}</li>;
        })}</ul> : <p className="mt-4 text-sm text-neutral-500">暂无符合条件的兑换记录。</p>}
      </section>
      <section className="rounded-3xl border border-[var(--bd-border)] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">兑换商城</h2><PrimaryButton fullWidth={false} onClick={() => openEditor()}>＋ 新增项目</PrimaryButton></div>
        <p className="mt-1 text-sm text-neutral-500">家庭共享项目；停用后所有关联学生都无法申请。</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">{visibleCatalog.map((item) => <li key={item.id} className="rounded-2xl border border-neutral-200 p-3"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-500">家庭共享 · {item.cost} 积分 · {item.active ? "启用" : "已停用"}</p>{item.description ? <p className="mt-2 text-sm text-neutral-600">{item.description}</p> : null}<div className="mt-3 flex gap-2"><SecondaryButton onClick={() => openEditor(item)}>变更</SecondaryButton><SecondaryButton onClick={() => setConfirming({ kind: "toggle", item })}>{item.active ? "停用" : "启用"}</SecondaryButton></div></li>)}</ul>
      </section>
    </div>}
    {editor ? <Modal title={editor.item ? "变更兑换项目" : "新增兑换项目"} onClose={() => setEditor(null)}><form className="flex flex-col gap-4" onSubmit={(event) => void saveCatalog(event)}><p className="text-sm text-neutral-500">该项目对当前关联的全部学生可见。</p><Field label="名称"><TextInput required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="说明（可选）"><TextInput value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="所需积分"><TextInput required type="number" min={1} value={cost} onChange={(event) => setCost(event.target.value)} /></Field><Field label="每月限次（可选）"><TextInput type="number" min={1} value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} /></Field><PrimaryButton type="submit" disabled={saving}>{saving ? "保存中…" : "保存项目"}</PrimaryButton></form></Modal> : null}
  </PageShell>;
}
