"use client";

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

export default function StudentChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    void fetchSession().then((session) => {
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      if (!session.mustChangePassword) {
        router.replace("/");
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
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          idempotencyKey: newIdempotencyKey("change-password"),
        }),
      });
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "修改密码失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="修改密码">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="修改初始密码" subtitle="首次登录必须修改密码后才能继续">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Field label="当前密码">
          <TextInput
            data-testid="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="新密码（至少 12 位）">
          <TextInput
            data-testid="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={12}
            required
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "确认修改"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
