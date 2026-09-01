"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  cancelRedemption,
  createRedemption,
  fetchRedemptionCatalog,
  fetchRedemptions,
  redemptionStatusLabel,
  type CatalogItemDto,
  type RedemptionDto,
} from "@/lib/client/m6-api";

export default function StudentRedemptionPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionDto[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadData = useCallback(async (sid: string) => {
    setError(null);
    const [catalogResult, redemptionsResult] = await Promise.all([
      fetchRedemptionCatalog(sid, true),
      fetchRedemptions(sid),
    ]);
    setCatalog(catalogResult.items);
    setRedemptions(redemptionsResult.redemptions);
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      if (session.mustChangePassword) {
        router.replace("/student/change-password");
        return;
      }

      setStudentId(session.userId);
      try {
        await loadData(session.userId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载兑换数据失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData, router]);

  async function onApply(catalogItemId: string) {
    if (!studentId) return;
    setSubmittingId(catalogItemId);
    setActionMessage(null);
    setError(null);
    try {
      const result = await createRedemption(studentId, catalogItemId);
      setActionMessage(
        result.idempotentReplay ? "申请已提交（幂等回放）" : "兑换申请已提交，等待家长审批",
      );
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交申请失败");
    } finally {
      setSubmittingId(null);
    }
  }

  async function onCancel(redemptionId: string) {
    if (!studentId) return;
    setSubmittingId(redemptionId);
    setActionMessage(null);
    setError(null);
    try {
      const result = await cancelRedemption(studentId, redemptionId);
      setActionMessage(result.idempotentReplay ? "已撤销（幂等回放）" : "兑换申请已撤销");
      await loadData(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "撤销失败");
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return (
      <PageShell title="积分兑换">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="积分兑换" subtitle="申请线下奖励兑换" backHref="/" showLogout>
      {studentId ? <PointsTodayCard studentId={studentId} /> : null}

      {actionMessage ? (
        <Alert tone="success" data-testid="redemption-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" data-testid="redemption-error">
          {error}
        </Alert>
      ) : null}

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">可兑换目录</h2>
        {catalog.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500" data-testid="catalog-empty">
            暂无可兑换项目。请让家长创建目录项。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {catalog.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-neutral-200 p-3"
                data-testid={`catalog-item-${item.id}`}
              >
                <p className="font-medium break-words">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-sm text-neutral-600 break-words">{item.description}</p>
                ) : null}
                <p className="mt-2 text-sm text-neutral-600">所需积分：{item.cost}</p>
                {item.monthlyLimit ? (
                  <p className="text-sm text-neutral-500">每月限 {item.monthlyLimit} 次</p>
                ) : null}
                <PrimaryButton
                  className="mt-3"
                  disabled={submittingId === item.id}
                  onClick={() => void onApply(item.id)}
                  data-testid={`apply-redemption-${item.id}`}
                >
                  {submittingId === item.id ? "提交中…" : "申请兑换"}
                </PrimaryButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">我的申请</h2>
        {redemptions.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500" data-testid="redemptions-empty">
            暂无兑换申请。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {redemptions.map((redemption) => (
              <li
                key={redemption.id}
                className="rounded-lg border border-neutral-200 p-3"
                data-testid={`redemption-item-${redemption.id}`}
              >
                <p className="text-sm">
                  状态：
                  <span data-testid={`redemption-status-${redemption.id}`}>
                    {redemptionStatusLabel(redemption.status)}
                  </span>
                </p>
                <p className="text-sm text-neutral-600">扣减积分：{redemption.costSnapshot}</p>
                {redemption.rejectionReason ? (
                  <p className="mt-1 text-sm text-red-700 break-words">
                    拒绝理由：{redemption.rejectionReason}
                  </p>
                ) : null}
                {redemption.status === "pending" ? (
                  <PrimaryButton
                    className="mt-3"
                    disabled={submittingId === redemption.id}
                    onClick={() => void onCancel(redemption.id)}
                    data-testid={`cancel-redemption-${redemption.id}`}
                  >
                    {submittingId === redemption.id ? "撤销中…" : "撤销申请"}
                  </PrimaryButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
