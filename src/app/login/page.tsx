"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PasswordField } from "@/components/ui/password-field";

import { Alert, Field, PageShell, PrimaryButton, TextInput } from "@/components/ui/page-shell";
import {
  ApiError,
  apiFetch,
  clearSessionCache,
  fetchSession,
  newIdempotencyKey,
} from "@/lib/client/api";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    void fetchSession()
      .then((session) => {
        if (session) {
          router.replace(session.mustChangePassword ? "/change-password" : "/");
        }
      })
      .catch(() => setError("登录状态暂时无法获取，你可以重新登录。"));
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        userId?: string;
        contactVerified?: boolean;
        mfaRequired?: boolean;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          password,
          ...(mfaRequired ? { totpCode } : {}),
          idempotencyKey: newIdempotencyKey("login"),
        }),
      });

      if (result.mfaRequired) {
        setMfaRequired(true);
        setTotpCode("");
        return;
      }

      clearSessionCache();
      const session = await fetchSession({ force: true });

      if (session?.mustChangePassword) {
        router.push("/change-password");
        return;
      }

      if (session && session.role !== "admin" && !session.contactVerified) {
        router.push("/verify-contact");
        return;
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="登录"
      subtitle="家长使用邮箱/手机，学生使用用户名"
      hideTabs
      showThemeToggle
      hideHeading
    >
      <div className="bd-login-card">
        <header className="bd-login-heading">
          <h1 className="text-2xl font-black tracking-tight">登录 BrainDance</h1>
          <p className="mt-2 text-sm text-[var(--bd-muted)]">家长使用邮箱/手机，学生使用用户名</p>
        </header>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field label="账号">
            <TextInput
              data-testid="login-identifier"
              autoComplete="username"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setMfaRequired(false);
                setTotpCode("");
              }}
              required
            />
          </Field>
          <PasswordField
            label="密码"
            testId="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setMfaRequired(false);
              setTotpCode("");
            }}
            required
          />
          {mfaRequired ? (
            <Field label="管理员验证器验证码">
              <TextInput
                data-testid="login-totp"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <PrimaryButton type="submit" disabled={loading}>
            {loading ? "登录中…" : mfaRequired ? "验证并登录" : "登录"}
          </PrimaryButton>
          <Link href="/register" className="bd-inline-link justify-center">
            还没有账号？受邀注册 →
          </Link>
        </form>
      </div>
    </PageShell>
  );
}
