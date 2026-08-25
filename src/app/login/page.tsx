"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Field, PageShell, PrimaryButton, TextInput } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchSession().then((session) => {
      if (session) {
        router.replace("/");
      }
    });
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
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

      if (!result.contactVerified) {
        router.push("/verify-contact");
        return;
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="登录" subtitle="家长使用邮箱/手机，学生使用用户名">
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
        <Field label="密码">
          <TextInput
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "登录中…" : "登录"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
