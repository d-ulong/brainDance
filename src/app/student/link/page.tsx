"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

type PendingRequest = {
  requestId: string;
  parentId: string;
  status: string;
  expiresAt: string;
};

export default function StudentLinkPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [associationCode, setAssociationCode] = useState<string | null>(null);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  async function loadRequests() {
    const result = await apiFetch<{ requests: PendingRequest[] }>("/api/relationship-requests");
    setRequests(result.requests);
  }

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

      try {
        await loadRequests();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function issueCode() {
    setIssuing(true);
    setError(null);
    try {
      const result = await apiFetch<{ code?: string }>("/api/association-codes", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: newIdempotencyKey("issue-code") }),
      });
      if (!result.code) {
        throw new Error("未返回关联码");
      }
      setAssociationCode(result.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成关联码失败");
    } finally {
      setIssuing(false);
    }
  }

  async function acceptRequest(requestId: string) {
    setAcceptingId(requestId);
    setError(null);
    try {
      await apiFetch(`/api/relationship-requests/${requestId}/accept`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: newIdempotencyKey("accept-req") }),
      });
      await loadRequests();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "接受关联失败");
    } finally {
      setAcceptingId(null);
    }
  }

  if (loading) {
    return (
      <PageShell title="关联家长">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="关联家长" subtitle="生成关联码并提供给家长" backHref="/" showLogout>
      <PrimaryButton disabled={issuing} onClick={() => void issueCode()}>
        {issuing ? "生成中…" : "生成关联码"}
      </PrimaryButton>

      {associationCode ? (
        <Alert tone="success">
          <p className="font-medium">关联码（请提供给家长）</p>
          <p data-testid="association-code" className="mt-2 break-all font-mono text-base">
            {associationCode}
          </p>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-800">待处理申请</h2>
        {requests.length === 0 ? (
          <Alert tone="info">暂无待处理的关联申请</Alert>
        ) : (
          requests.map((request) => (
            <div
              key={request.requestId}
              className="rounded-xl border border-neutral-300 bg-white p-4"
            >
              <p className="text-sm text-neutral-600">家长 ID：{request.parentId.slice(0, 8)}…</p>
              <PrimaryButton
                data-testid={`accept-request-${request.requestId}`}
                disabled={acceptingId === request.requestId}
                onClick={() => void acceptRequest(request.requestId)}
              >
                {acceptingId === request.requestId ? "处理中…" : "接受关联"}
              </PrimaryButton>
            </div>
          ))
        )}
      </section>

      {error ? <Alert tone="error">{error}</Alert> : null}
    </PageShell>
  );
}
