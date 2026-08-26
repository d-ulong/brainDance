"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Alert,
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  TextInput,
} from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

export default function ParentLinkPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ studentId: string } | null>(null);
  const [associationCode, setAssociationCode] = useState("");

  useEffect(() => {
    void fetchSession().then((session) => {
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }
      setLoading(false);
    });
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ studentId: string }>("/api/relationship-requests", {
        method: "POST",
        body: JSON.stringify({
          associationCode,
          idempotencyKey: newIdempotencyKey("parent-link"),
        }),
      });
      setSuccess(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "关联申请失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="关联学生">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="关联学生" subtitle="输入学生提供的关联码" backHref="/" showLogout>
      {success ? (
        <Alert tone="success">
          <p>关联申请已发送，请等待学生确认。</p>
          <Link
            href={`/parent/students/${success.studentId}/training`}
            className="mt-3 inline-block text-sm font-medium underline"
          >
            查看学生训练汇总
          </Link>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field label="关联码">
            <TextInput
              data-testid="association-code-input"
              value={associationCode}
              onChange={(e) => setAssociationCode(e.target.value)}
              required
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "提交中…" : "发送关联申请"}
          </PrimaryButton>
        </form>
      )}
    </PageShell>
  );
}
