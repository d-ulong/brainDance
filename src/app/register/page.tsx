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

export default function RegisterPage() {
  const router = useRouter();
  const [invitationCode, setInvitationCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        <Field label="密码（至少 12 位）">
          <TextInput
            data-testid="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "注册中…" : "注册并继续验证"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
