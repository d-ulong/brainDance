"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
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
    <PageShell title="训练中心" subtitle="选择一项标准训练开始练习" backHref="/" showLogout>
      <TrainingDisclaimer />
      <Alert tone="info">
        训练参数按年龄档（5–8 / 9–12 / 13–18
        岁）自动匹配；生日跨档后新训练使用新档，历史趋势会分段展示。
      </Alert>
      <p className="text-sm text-neutral-600">
        以下三项为固定标准训练，用于个人练习与趋势复盘，不构成诊断或排名。
      </p>
      <nav className="flex flex-col gap-3" aria-label="训练项目">
        {TRAINING_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            data-testid={`training-entry-${option.key}`}
            className="flex min-h-11 flex-col gap-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            <span className="text-sm font-semibold">{option.title}</span>
            <span className="text-xs text-neutral-600">{option.description}</span>
          </Link>
        ))}
      </nav>
    </PageShell>
  );
}
