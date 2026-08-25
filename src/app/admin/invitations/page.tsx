"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Field, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

export default function AdminInvitationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitationCode, setInvitationCode] = useState<string | null>(null);

  useEffect(() => {
    void fetchSession().then((session) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      if (session.role !== "admin") {
        router.replace("/");
        return;
      }
      setLoading(false);
    });
  }, [router]);

  async function createInvitation() {
    setSubmitting(true);
    setError(null);
    setInvitationCode(null);
    try {
      const result = await apiFetch<{ code?: string }>("/api/admin/invitations", {
        method: "POST",
        body: JSON.stringify({
          targetRole: "parent",
          idempotencyKey: newIdempotencyKey("admin-invite"),
        }),
      });
      if (!result.code) {
        throw new Error("未返回邀请码");
      }
      setInvitationCode(result.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建邀请码失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="创建邀请码">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="创建家长邀请码" backHref="/" showLogout>
      <PrimaryButton disabled={submitting} onClick={() => void createInvitation()}>
        {submitting ? "创建中…" : "生成邀请码"}
      </PrimaryButton>
      {invitationCode ? (
        <Alert tone="success">
          <p className="font-medium">邀请码已生成</p>
          <p data-testid="invitation-code" className="mt-2 break-all font-mono text-base">
            {invitationCode}
          </p>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="说明">
        <p className="text-sm font-normal text-neutral-600">
          将邀请码提供给家长，在注册页使用。邀请码仅显示一次，请复制保存。
        </p>
      </Field>
    </PageShell>
  );
}
