"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
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
    <PageShell title="家长训练中心" subtitle="个人练习与趋势复盘" backHref="/" showLogout>
      <TrainingDisclaimer />
      <Alert tone="info" data-testid="parent-training-adult-notice">
        本页为家长本人的个人练习与趋势复盘，使用成人训练参数；不构成诊断或排名，不展示儿童年龄档、家庭成员比较或学生数据。
      </Alert>
      <p className="text-sm text-neutral-600">
        以下三项为固定标准训练，记录仅属于您自己，不会混入学生练习数据或产生家庭协作副作用。
      </p>
      <nav
        className="flex flex-col gap-3"
        aria-label="家长训练项目"
        data-testid="parent-training-hub"
      >
        {PARENT_TRAINING_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            data-testid={`parent-training-entry-${option.key}`}
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
