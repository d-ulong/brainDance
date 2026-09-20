"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession } from "@/lib/client/api";
import { TRAINING_OPTIONS } from "@/lib/client/training-api";

export default function TrainingHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      if (session.mustChangePassword) {
        router.replace("/student/change-password");
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <PageShell title="训练中心">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="训练中心"
      headingAside={
        <p className="text-xs text-[var(--bd-muted)]">
          训练参数按年龄档（5–8 / 9–12 / 13–18 岁）自动匹配。
          <br />
          跨档后历史趋势分段展示；选择一项标准训练开始练习。
        </p>
      }
      backHref="/"
      showLogout
    >
      <nav className="grid gap-4 sm:grid-cols-3" aria-label="训练项目">
        {TRAINING_OPTIONS.map((option, index) => (
          <Link
            key={option.key}
            href={option.href}
            data-testid={`training-entry-${option.key}`}
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
