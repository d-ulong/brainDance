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
  approveRedemption,
  createCatalogItem,
  fetchRedemptionCatalog,
  fetchRedemptions,
  redemptionStatusLabel,
  rejectRedemption,
  updateCatalogItem,
  type CatalogItemDto,
  type RedemptionDto,
} from "@/lib/client/m6-api";

export default function ParentRedemptionPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const [title, setTitle] = useState("周末外出");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("20");
  const [monthlyLimit, setMonthlyLimit] = useState("");

  const loadData = useCallback(async (sid: string) => {
    setError(null);
    setForbidden(false);
    try {
      const [catalogResult, redemptionsResult] = await Promise.all([
        fetchRedemptionCatalog(sid, false),
        fetchRedemptions(sid),
      ]);
      setCatalog(catalogResult.items);
      setRedemptions(redemptionsResult.redemptions);
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
        await loadData(sid);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData, params, router]);

  async function onCreateCatalog(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    setCreating(true);
    setActionMessage(null);
    setError(null);
    try {
      await createCatalogItem(studentId, {
        title,
        description: description.trim() ? description : null,
        cost: Number(cost),
        monthlyLimit: monthlyLimit.trim() ? Number(monthlyLimit) : null,
      });
      setActionMessage("目录项已创建");
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建目录项失败");
    } finally {
      setCreating(false);
    }
  }

  async function onToggleActive(item: CatalogItemDto) {
    if (!studentId) return;
    setSubmittingId(item.id);
    setActionMessage(null);
    setError(null);
    try {
      await updateCatalogItem(studentId, item.id, { active: !item.active });
      setActionMessage(item.active ? "目录项已停用" : "目录项已启用");
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新目录项失败");
    } finally {
      setSubmittingId(null);
    }
  }

  async function onApprove(redemptionId: string) {
    if (!studentId) return;
    setSubmittingId(redemptionId);
    setActionMessage(null);
    setError(null);
    try {
      const result = await approveRedemption(studentId, redemptionId);
      setActionMessage(
        result.idempotentReplay ? "已批准（幂等回放）" : "兑换申请已批准，积分已扣减",
      );
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "批准失败");
    } finally {
      setSubmittingId(null);
    }
  }

  async function onReject(redemptionId: string) {
    if (!studentId || !rejectReason.trim()) {
      setError("请填写拒绝理由");
      return;
    }
    setSubmittingId(redemptionId);
    setActionMessage(null);
    setError(null);
    try {
      await rejectRedemption(studentId, redemptionId, rejectReason.trim());
      setActionMessage("兑换申请已拒绝");
      setRejectingId(null);
      setRejectReason("");
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "拒绝失败");
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return (
      <PageShell title="兑换目录">
        <LoadingState />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell title="兑换目录" backHref="/parent/students" showLogout>
        <Alert tone="error" data-testid="parent-forbidden">
          无权限访问该学生数据。
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="兑换目录"
      subtitle="管理目录与审批申请"
      backHref="/parent/students"
      showLogout
    >
      {studentId ? <PointsTodayCard studentId={studentId} /> : null}

      {actionMessage ? (
        <Alert tone="success" data-testid="parent-redemption-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" data-testid="parent-redemption-error">
          {error}
        </Alert>
      ) : null}

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">创建目录项</h2>
        <form className="mt-3 flex flex-col gap-4" onSubmit={onCreateCatalog}>
          <Field label="名称">
            <TextInput
              data-testid="catalog-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </Field>
          <Field label="说明（可选）">
            <TextInput
              data-testid="catalog-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="所需积分">
            <TextInput
              data-testid="catalog-cost"
              type="number"
              min={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
          </Field>
          <Field label="每月限次（可选）">
            <TextInput
              data-testid="catalog-monthly-limit"
              type="number"
              min={1}
              value={monthlyLimit}
              onChange={(e) => setMonthlyLimit(e.target.value)}
            />
          </Field>
          <PrimaryButton type="submit" disabled={creating} data-testid="create-catalog-button">
            {creating ? "创建中…" : "创建目录项"}
          </PrimaryButton>
        </form>
      </section>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">目录列表</h2>
        {catalog.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">暂无目录项</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {catalog.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-neutral-200 p-3"
                data-testid={`parent-catalog-item-${item.id}`}
              >
                <p className="font-medium break-words">{item.title}</p>
                <p className="text-sm text-neutral-600">
                  状态：
                  <span data-testid={`catalog-active-${item.id}`}>
                    {item.active ? "启用" : "已停用"}
                  </span>
                  ｜积分：{item.cost}
                </p>
                <PrimaryButton
                  className="mt-3"
                  disabled={submittingId === item.id}
                  onClick={() => void onToggleActive(item)}
                  data-testid={`toggle-catalog-${item.id}`}
                >
                  {submittingId === item.id ? "更新中…" : item.active ? "停用" : "启用"}
                </PrimaryButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">待审批申请</h2>
        {redemptions.filter((r) => r.status === "pending").length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500" data-testid="pending-redemptions-empty">
            暂无待审批申请
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {redemptions
              .filter((r) => r.status === "pending")
              .map((redemption) => (
                <li
                  key={redemption.id}
                  className="rounded-lg border border-neutral-200 p-3"
                  data-testid={`pending-redemption-${redemption.id}`}
                >
                  <p className="text-sm">
                    状态：
                    <span>{redemptionStatusLabel(redemption.status)}</span>
                  </p>
                  <p className="text-sm text-neutral-600">扣减积分：{redemption.costSnapshot}</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <PrimaryButton
                      disabled={submittingId === redemption.id}
                      onClick={() => void onApprove(redemption.id)}
                      data-testid={`approve-redemption-${redemption.id}`}
                    >
                      {submittingId === redemption.id ? "处理中…" : "批准"}
                    </PrimaryButton>
                    {rejectingId === redemption.id ? (
                      <div className="flex flex-col gap-2">
                        <TextInput
                          data-testid={`reject-reason-${redemption.id}`}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="拒绝理由"
                        />
                        <PrimaryButton
                          disabled={submittingId === redemption.id}
                          onClick={() => void onReject(redemption.id)}
                          data-testid={`confirm-reject-${redemption.id}`}
                        >
                          确认拒绝
                        </PrimaryButton>
                      </div>
                    ) : (
                      <PrimaryButton
                        disabled={submittingId === redemption.id}
                        onClick={() => setRejectingId(redemption.id)}
                        data-testid={`reject-redemption-${redemption.id}`}
                      >
                        拒绝
                      </PrimaryButton>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
