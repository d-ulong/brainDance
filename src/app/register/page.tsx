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
import { PasswordField } from "@/components/ui/password-field";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";
import {
  PRODUCT_PASSWORD_MAX_LENGTH,
  PRODUCT_PASSWORD_MIN_LENGTH,
  PRODUCT_PASSWORD_RULE_DESCRIPTION,
} from "@/modules/identity/password-policy";

export default function RegisterPage() {
  const router = useRouter();
  const [invitationCode, setInvitationCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void fetchSession().then((session) => {
      if (session) {
        router.replace("/");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          invitationCode,
          displayName,
          email,
          password,
          idempotencyKey: newIdempotencyKey("register"),
        }),
      });
      router.push("/verify-contact");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <PageShell title="家长注册">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="家长注册" subtitle="使用管理员提供的邀请码创建账号" backHref="/">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Field label="邀请码">
          <TextInput
            data-testid="register-invitation-code"
            value={invitationCode}
            onChange={(e) => setInvitationCode(e.target.value)}
            required
          />
        </Field>
        <Field label="显示名称">
          <TextInput
            data-testid="register-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </Field>
        <Field label="邮箱">
          <TextInput
            data-testid="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <PasswordField
          label={`密码（${PRODUCT_PASSWORD_RULE_DESCRIPTION}）`}
          testId="register-password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          minLength={PRODUCT_PASSWORD_MIN_LENGTH}
          maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
          required
        />
        <PasswordField
          label="确认密码"
          testId="register-password-confirm"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          minLength={PRODUCT_PASSWORD_MIN_LENGTH}
          maxLength={PRODUCT_PASSWORD_MAX_LENGTH}
          required
        />
        {error ? (
          <Alert tone="error" data-testid="register-error">
            {error}
          </Alert>
        ) : null}
        <PrimaryButton type="submit" disabled={loading} data-testid="register-submit">
          {loading ? "注册中…" : "注册并继续验证"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
