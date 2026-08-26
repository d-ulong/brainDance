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

export default function VerifyContactPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(true);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      if (session.contactVerified) {
        router.replace("/");
        return;
      }

      try {
        const issued = await apiFetch<{ devOtp?: string }>("/api/auth/verify-contact/issue", {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: newIdempotencyKey("issue-otp") }),
        });
        if (issued.devOtp) {
          setDevOtp(issued.devOtp);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法发送验证码");
      } finally {
        setIssuing(false);
      }
    })();
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/verify-contact/confirm", {
        method: "POST",
        body: JSON.stringify({
          otp,
          idempotencyKey: newIdempotencyKey("verify-otp"),
        }),
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "验证失败");
    } finally {
      setLoading(false);
    }
  }

  if (issuing) {
    return (
      <PageShell title="验证联系方式">
        <LoadingState label="正在发送验证码…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="验证联系方式" subtitle="请输入发送到您邮箱/手机的验证码">
      {devOtp ? (
        <Alert tone="info" data-testid="dev-otp">
          开发环境验证码：<strong>{devOtp}</strong>
        </Alert>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Field label="验证码">
          <TextInput
            data-testid="verify-otp"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "验证中…" : "确认验证"}
        </PrimaryButton>
      </form>
    </PageShell>
  );
}
