"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  cancelDeletionRequest,
  confirmDeletionRequest,
  createDeletionRequest,
  deletionStatusLabel,
  fetchDeletionRequest,
  type DeletionRequestDto,
} from "@/lib/client/m6-api";

const DELETION_REQUEST_STORAGE_KEY = "m6-deletion-request-id";

function readStoredDeletionRequestId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(DELETION_REQUEST_STORAGE_KEY);
}

function storeDeletionRequestId(requestId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(DELETION_REQUEST_STORAGE_KEY, requestId);
}

function clearStoredDeletionRequestId(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DELETION_REQUEST_STORAGE_KEY);
}

export default function StudentAccountDeletionPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [request, setRequest] = useState<DeletionRequestDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRequestConfirm, setShowRequestConfirm] = useState(false);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const loadRequest = useCallback(async (requestId: string) => {
    const result = await fetchDeletionRequest(requestId);
    setRequest(result.request);
    storeDeletionRequestId(requestId);
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
      const storedRequestId = readStoredDeletionRequestId();
      if (storedRequestId) {
        try {
          await loadRequest(storedRequestId);
        } catch {
          // Stale or unauthorized stored id; allow creating a new request.
          clearStoredDeletionRequestId();
        }
      }
      setLoading(false);
    })();
  }, [loadRequest, router]);

  async function onRequestDeletion() {
    if (!studentId || !acknowledged) {
      setError("请先阅读并确认删除影响");
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await createDeletionRequest("student_account", studentId);
      // Freeze immediately revokes sessions; keep local DTO from create response so UI
      // can show frozen state even if the follow-up GET fails.
      const localRequest: DeletionRequestDto = {
        id: result.requestId,
        targetType: "student_account",
        targetId: studentId,
        studentId,
        requestedBy: studentId,
        status: result.status,
        revocableUntil: result.revocableUntil,
        studentConfirmedAt: null,
        requestedAt: new Date().toISOString(),
        executedAt: null,
      };
      setRequest(localRequest);
      storeDeletionRequestId(result.requestId);
      setActionMessage(
        result.idempotentReplay
          ? "删除请求已存在（幂等回放）"
          : "账户删除请求已提交，账户已冻结。若后续操作提示会话失效，请重新登录后继续撤销或确认。",
      );
      setShowRequestConfirm(false);
      try {
        await loadRequest(result.requestId);
      } catch {
        // Expected when the create path revoked the current session.
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交删除请求失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancel() {
    if (!request) return;
    setSubmitting(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await cancelDeletionRequest(request.id);
      setActionMessage(
        result.idempotentReplay ? "已撤销（幂等回放）" : "删除请求已撤销，账户已恢复访问",
      );
      clearStoredDeletionRequestId();
      try {
        await loadRequest(request.id);
      } catch {
        setRequest({ ...request, status: result.status });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "撤销失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirmExecution() {
    if (!request) return;
    setSubmitting(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await confirmDeletionRequest(request.id);
      setActionMessage(
        result.idempotentReplay ? "已确认（幂等回放）" : "已确认最终删除，后台将按步骤清除数据",
      );
      setShowExecuteConfirm(false);
      try {
        await loadRequest(request.id);
      } catch {
        setRequest({
          ...request,
          studentConfirmedAt: result.studentConfirmedAt,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "确认失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="账户删除">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="账户删除" subtitle="请求删除学生账户及关联数据" backHref="/" showLogout>
      <Alert tone="info" data-testid="deletion-warning">
        删除账户将冻结所有读写访问，并在确认后清除可识别正文。不可变积分流水与无正文审计将保留完整性所需字段。
        30 天撤销期内可取消请求。
      </Alert>

      {actionMessage ? (
        <Alert tone="success" data-testid="deletion-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" data-testid="deletion-error">
          {error}
        </Alert>
      ) : null}

      {request ? (
        <section
          className="rounded-xl border border-neutral-300 bg-white p-4"
          data-testid="deletion-request-detail"
        >
          <h2 className="text-sm font-semibold">当前删除请求</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">状态</dt>
              <dd data-testid="deletion-status">{deletionStatusLabel(request.status)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">撤销截止</dt>
              <dd>{new Date(request.revocableUntil).toLocaleDateString("zh-CN")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">学生确认</dt>
              <dd data-testid="deletion-student-confirmed">
                {request.studentConfirmedAt ? "已确认" : "未确认"}
              </dd>
            </div>
          </dl>

          {request.status === "frozen" && !request.studentConfirmedAt ? (
            <div className="mt-4 flex flex-col gap-3">
              <PrimaryButton
                disabled={submitting}
                onClick={() => void onCancel()}
                data-testid="cancel-deletion-button"
              >
                {submitting ? "撤销中…" : "撤销删除请求"}
              </PrimaryButton>
              {!showExecuteConfirm ? (
                <PrimaryButton
                  disabled={submitting}
                  onClick={() => setShowExecuteConfirm(true)}
                  data-testid="open-confirm-deletion-button"
                >
                  确认最终删除
                </PrimaryButton>
              ) : (
                <div className="rounded-lg border border-red-300 bg-red-50 p-4">
                  <p className="text-sm text-red-900" data-testid="deletion-danger-text">
                    此操作不可撤销。确认后系统将开始清除账户正文与可识别字段。
                  </p>
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      data-testid="deletion-execute-ack"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    我已了解影响范围并确认执行删除
                  </label>
                  <PrimaryButton
                    className="mt-3"
                    disabled={submitting || !acknowledged}
                    onClick={() => void onConfirmExecution()}
                    data-testid="confirm-deletion-button"
                  >
                    {submitting ? "确认中…" : "确认执行删除"}
                  </PrimaryButton>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-xl border border-neutral-300 bg-white p-4">
          {!showRequestConfirm ? (
            <PrimaryButton
              onClick={() => setShowRequestConfirm(true)}
              data-testid="open-deletion-request-button"
            >
              请求删除我的账户
            </PrimaryButton>
          ) : (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4">
              <p className="text-sm text-red-900" data-testid="deletion-request-danger-text">
                提交后将立即冻结账户访问（包括训练、日程、兑换与导出），30 天内可撤销。
              </p>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="deletion-request-ack"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                我已了解冻结与撤销期规则
              </label>
              <PrimaryButton
                className="mt-3"
                disabled={submitting || !acknowledged}
                onClick={() => void onRequestDeletion()}
                data-testid="submit-deletion-request-button"
              >
                {submitting ? "提交中…" : "提交删除请求"}
              </PrimaryButton>
            </div>
          )}
        </section>
      )}
    </PageShell>
  );
}
