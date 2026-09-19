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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    void fetchSession().then((session) => {
      if (session) {
        router.replace("/");
      }
    });
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        userId: string;
        contactVerified: boolean;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          password,
          idempotencyKey: newIdempotencyKey("login"),
        }),
      });

      clearSessionCache();
      await fetchSession({ force: true });

      if (!result.contactVerified) {
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
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </Field>
          <PasswordField
            label="密码"
            testId="login-password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            required
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <PrimaryButton type="submit" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </PrimaryButton>
          <Link href="/register" className="bd-inline-link justify-center">
            还没有账号？受邀注册 →
          </Link>
        </form>
      </div>
    </PageShell>
  );
}
