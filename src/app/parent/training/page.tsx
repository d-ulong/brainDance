"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession } from "@/lib/client/api";
import { PARENT_TRAINING_OPTIONS } from "@/lib/client/training-api";

export default function ParentTrainingHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <PageShell title="家长训练中心">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="家长训练中心"
      backHref="/"
      showLogout
      headingAside={
        <div className="space-y-1 text-left text-xs leading-snug text-[var(--bd-muted)] sm:text-right">
          <p data-testid="parent-training-adult-notice">
            成人参数 · 仅记录自己的练习 · 不混入学生数据或产生家庭协作副作用
          </p>
          <p>本训练仅供日常认知练习，不构成医学或智力诊断。</p>
        </div>
      }
    >
      <nav
        className="grid gap-4 sm:grid-cols-3"
        aria-label="家长训练项目"
        data-testid="parent-training-hub"
      >
        {PARENT_TRAINING_OPTIONS.map((option, index) => (
          <Link
            key={option.key}
            href={option.href}
            data-testid={`parent-training-entry-${option.key}`}
            className="bd-panel flex min-h-40 flex-col gap-3 hover:bg-neutral-50"
          >
            <span className={`bd-training-icon bd-tone-${index}`} aria-hidden="true">
              {["⚡", "🎨", "🔢"][index]}
            </span>
            <span className="text-sm font-semibold">{option.title}</span>
            <span className="text-xs text-neutral-600">{option.description}</span>
          </Link>
        ))}
      </nav>
    </PageShell>
  );
}
