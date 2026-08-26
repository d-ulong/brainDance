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

export default function ParentCreateStudentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ studentId: string; username: string } | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("2015-06-01");
  const [initialPassword, setInitialPassword] = useState("InitialPass123!Go");

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
      const result = await apiFetch<{ studentId: string; username: string }>(
        "/api/family/students",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            displayName: displayName || username,
            birthDate,
            initialPassword,
            idempotencyKey: newIdempotencyKey("create-student"),
          }),
        },
      );
      setSuccess(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="创建学生">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="创建学生账号" subtitle="5–12 岁受控学生（路径 A）" backHref="/" showLogout>
      {success ? (
        <Alert tone="success">
          <p>
            学生账号已创建：
            <strong data-testid="created-student-username">{success.username}</strong>
          </p>
          <p className="mt-2 text-sm">请让学生使用初始密码登录并修改密码。</p>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field label="用户名">
            <TextInput
              data-testid="student-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Field>
          <Field label="显示名称">
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="出生日期">
            <TextInput
              data-testid="student-birth-date"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
            />
          </Field>
          <Field label="初始密码">
            <TextInput
              data-testid="student-initial-password"
              type="password"
              value={initialPassword}
              onChange={(e) => setInitialPassword(e.target.value)}
              minLength={12}
              required
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "创建中…" : "创建学生"}
          </PrimaryButton>
        </form>
      )}
    </PageShell>
  );
}
