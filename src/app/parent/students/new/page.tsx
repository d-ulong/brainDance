"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Alert,
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  TextInput,
} from "@/components/ui/page-shell";
import { PasswordField } from "@/components/ui/password-field";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";
import {
  PRODUCT_PASSWORD_MAX_LENGTH,
  PRODUCT_PASSWORD_MIN_LENGTH,
  PRODUCT_PASSWORD_RULE_DESCRIPTION,
} from "@/modules/identity/password-policy";

export default function ParentCreateStudentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ studentId: string; username: string } | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
    if (initialPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ studentId: string; username: string }>(
        "/api/family/students",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            displayName,
            guardianConsent,
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
    <PageShell
      title="创建学生账号"
      subtitle="为 5–12 岁孩子创建独立账号，创建后直接加入你的家庭，不需要再次关联。"
      backHref="/parent/students"
      showLogout
    >
      {success ? (
        <Alert tone="success">
          <p>
            学生账号已创建：
            <strong data-testid="created-student-username">{success.username}</strong>
          </p>
          <p className="mt-2 text-sm">
            已自动加入你的家庭，无需再次绑定。请让学生使用初始密码登录并修改密码。
          </p>
          <Link className="bd-inline-link" href="/parent/students">
            查看我的家庭 →
          </Link>
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
          <Field label="姓名或昵称">
            <TextInput
              data-testid="student-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={64}
            />
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
          <PasswordField
            label={`初始密码（${PRODUCT_PASSWORD_RULE_DESCRIPTION}）`}
            testId="student-initial-password"
            autoComplete="new-password"
            value={initialPassword}
            onChange={setInitialPassword}
            minLength={PRODUCT_PASSWORD_MIN_LENGTH}
            maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
            required
          />
          <PasswordField
            label="确认初始密码"
            testId="student-initial-password-confirm"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            minLength={PRODUCT_PASSWORD_MIN_LENGTH}
            maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
            required
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              required
              checked={guardianConsent}
              onChange={(e) => setGuardianConsent(e.target.checked)}
            />
            <span>
              我是该学生的家长，同意创建独立学生账号并建立家庭关联，按监护同意与隐私规则陪伴使用。
            </span>
          </label>
          {error ? (
            <Alert tone="error" data-testid="create-student-error">
              {error}
            </Alert>
          ) : null}
          <PrimaryButton type="submit" disabled={submitting} data-testid="create-student-submit">
            {submitting ? "创建中…" : "创建学生"}
          </PrimaryButton>
        </form>
      )}
    </PageShell>
  );
}
