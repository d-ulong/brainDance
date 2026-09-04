"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { PasswordField } from "@/components/ui/password-field";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";
import {
  PRODUCT_PASSWORD_MAX_LENGTH,
  PRODUCT_PASSWORD_MIN_LENGTH,
  PRODUCT_PASSWORD_RULE_DESCRIPTION,
} from "@/modules/identity/password-policy";

export default function ParentChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
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
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          idempotencyKey: newIdempotencyKey("change-password"),
        }),
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
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
    <PageShell title="修改密码" subtitle="仅可修改自己的登录密码" backHref="/" showLogout>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <PasswordField
          label="当前密码"
          testId="current-password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          required
        />
        <PasswordField
          label={`新密码（${PRODUCT_PASSWORD_RULE_DESCRIPTION}）`}
          testId="new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          minLength={PRODUCT_PASSWORD_MIN_LENGTH}
          maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
          required
        />
        <PasswordField
          label="确认新密码"
          testId="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          minLength={PRODUCT_PASSWORD_MIN_LENGTH}
          maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
          required
        />
        {error ? (
          <Alert tone="error" data-testid="change-password-error">
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert tone="success" data-testid="change-password-success">
            密码已更新，请使用新密码登录后续会话。
          </Alert>
        ) : null}
        <PrimaryButton type="submit" disabled={submitting} data-testid="change-password-submit">
          {submitting ? "保存中…" : "确认修改"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
