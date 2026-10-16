"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  LoadingState,
  PageShell,
  PrimaryButton,
  SessionLoadError,
} from "@/components/ui/page-shell";
import { PasswordField } from "@/components/ui/password-field";
import {
  ApiError,
  apiFetch,
  clearSessionCache,
  fetchSession,
  newIdempotencyKey,
  type SessionInfo,
} from "@/lib/client/api";
import {
  isProductPasswordValid,
  PRODUCT_PASSWORD_MAX_LENGTH,
  PRODUCT_PASSWORD_MIN_LENGTH,
  PRODUCT_PASSWORD_RULE_DESCRIPTION,
} from "@/modules/identity/password-policy";

export function ChangePasswordForm({ expectedRole }: { expectedRole?: SessionInfo["role"] }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSessionFailed(false);
    void fetchSession()
      .then((value) => {
        if (cancelled) return;
        if (!value || (expectedRole && value.role !== expectedRole)) {
          router.replace("/login");
        } else if (value.mustChangePassword && expectedRole) {
          router.replace("/change-password");
        } else if (!value.mustChangePassword && value.role === "parent" && !value.contactVerified) {
          router.replace("/verify-contact");
        } else setSession(value);
      })
      .catch(() => {
        if (!cancelled) setSessionFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, expectedRole, attempt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) return setError("两次输入的密码不一致");
    if (!isProductPasswordValid(newPassword)) return setError(PRODUCT_PASSWORD_RULE_DESCRIPTION);
    if (newPassword === currentPassword) return setError("新密码不能与当前密码相同");
    submitting.current = true;
    setBusy(true);
    let passwordUpdated = false;
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          idempotencyKey: newIdempotencyKey("change-password"),
        }),
      });
      passwordUpdated = true;
      const wasRequired = session?.mustChangePassword;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      clearSessionCache();
      const refreshed = await fetchSession({ force: true });
      if (!refreshed) {
        window.location.assign("/login");
        return;
      }
      if (wasRequired) {
        window.location.assign(
          refreshed.role !== "admin" && !refreshed.contactVerified ? "/verify-contact" : "/",
        );
        return;
      }
      setSession(refreshed);
      setSuccess(true);
    } catch (failure) {
      setError(
        passwordUpdated
          ? "密码已更新，但登录状态刷新失败。请退出后使用新密码登录。"
          : failure instanceof ApiError
            ? failure.message
            : "未能确认修改结果，请尝试使用新密码重新登录；如失败，再用原密码登录。",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (sessionFailed)
    return (
      <PageShell title="加载失败" hideTabs>
        <SessionLoadError onRetry={() => setAttempt((value) => value + 1)} />
      </PageShell>
    );
  if (!session)
    return (
      <PageShell title="修改密码" hideTabs>
        <LoadingState />
      </PageShell>
    );
  const required = Boolean(session.mustChangePassword);
  return (
    <PageShell
      title={required ? "设置自己的新密码" : "修改密码"}
      subtitle={
        required
          ? "当前使用初始或临时密码。设置新密码后才能继续使用。"
          : "仅修改自己的登录密码，其他设备将退出登录。"
      }
      hideTabs={required}
      showLogout
      backHref={required ? undefined : "/account"}
    >
      <form className="bd-panel flex flex-col gap-4" onSubmit={submit}>
        {required ? (
          <Alert>请输入用于本次登录的初始或临时密码，再设置仅自己知道的新密码。</Alert>
        ) : null}
        <PasswordField
          label="当前密码"
          testId="current-password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          disabled={busy}
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
          disabled={busy}
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
          disabled={busy}
          required
        />
        {error ? (
          <Alert tone="error" role="alert" data-testid="change-password-error">
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert tone="success" role="status" data-testid="change-password-success">
            密码已更新，其他设备需使用新密码登录。
          </Alert>
        ) : null}
        <PrimaryButton type="submit" disabled={busy} data-testid="change-password-submit">
          {busy ? "保存中…" : "确认修改"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
