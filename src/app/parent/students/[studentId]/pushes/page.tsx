"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createPush,
  familyPushStatusLabel,
  listParentPushes,
  type FamilyPushDto,
} from "@/lib/client/m7-api";

export default function ParentPushesPage({ params }: { params: Promise<{ studentId: string }> }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushes, setPushes] = useState<FamilyPushDto[]>([]);
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [publishMode, setPublishMode] = useState<"immediate" | "scheduled" | "draft">("immediate");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (sid: string) => {
    const data = await listParentPushes(sid);
    setPushes(data.pushes);
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/parent/verify-contact");
        return;
      }
      setStudentId(resolved.studentId);
      try {
        await load(resolved.studentId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载推送失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, params, router]);

  async function onCreate() {
    if (!studentId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPush(studentId, {
        body: body || undefined,
        linkUrl: linkUrl || undefined,
        publishMode,
        scheduledPublishAt:
          publishMode === "scheduled" && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : undefined,
      });
      setBody("");
      setLinkUrl("");
      setScheduledAt("");
      await load(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建推送失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="家庭推送">
        <LoadingState label="加载中…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="家庭推送" backHref="/parent/students" showLogout>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        {error ? (
          <Alert tone="error" data-testid="push-error">
            {error}
          </Alert>
        ) : null}

        <section className="flex flex-col gap-3" data-testid="push-create-form">
          <h2 className="text-base font-medium">创建推送</h2>
          <label className="flex flex-col gap-1 text-sm">
            正文
            <textarea
              data-testid="push-body-input"
              className="min-h-24 rounded border border-neutral-300 px-3 py-2"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            原始链接（可选）
            <input
              data-testid="push-link-input"
              className="min-h-11 rounded border border-neutral-300 px-3 py-2"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://"
            />
          </label>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend>发布方式</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="publishMode"
                checked={publishMode === "immediate"}
                onChange={() => setPublishMode("immediate")}
                data-testid="push-mode-immediate"
              />
              立即发布
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="publishMode"
                checked={publishMode === "scheduled"}
                onChange={() => setPublishMode("scheduled")}
                data-testid="push-mode-scheduled"
              />
              预约发布
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="publishMode"
                checked={publishMode === "draft"}
                onChange={() => setPublishMode("draft")}
                data-testid="push-mode-draft"
              />
              保存草稿
            </label>
          </fieldset>
          {publishMode === "scheduled" ? (
            <label className="flex flex-col gap-1 text-sm">
              预约时间
              <input
                type="datetime-local"
                data-testid="push-schedule-input"
                className="min-h-11 rounded border border-neutral-300 px-3 py-2"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            data-testid="push-create-submit"
            className="min-h-11 rounded bg-neutral-900 px-4 text-white disabled:opacity-50"
            disabled={submitting}
            onClick={() => void onCreate()}
          >
            {submitting ? "提交中…" : "创建"}
          </button>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium">推送列表</h2>
          {pushes.length === 0 ? (
            <p className="text-sm text-neutral-600" data-testid="push-list-empty">
              暂无推送
            </p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="push-list">
              {pushes.map((push) => (
                <li key={push.pushId} className="rounded border border-neutral-300 p-3">
                  <p
                    className="text-xs text-neutral-500"
                    data-testid={`push-status-${push.pushId}`}
                  >
                    {familyPushStatusLabel(push.status)}
                    {push.canEdit ? " · 可编辑" : " · 只读"}
                  </p>
                  <p
                    className="mt-1 whitespace-pre-wrap text-sm"
                    data-testid={`push-body-${push.pushId}`}
                  >
                    {push.body || "(无正文)"}
                  </p>
                  {push.linkUrl ? (
                    <p
                      className="mt-1 break-all text-sm text-blue-700"
                      data-testid={`push-link-${push.pushId}`}
                    >
                      {push.linkUrl}
                    </p>
                  ) : null}
                  <Link
                    href={`/parent/students/${studentId}/pushes/${push.pushId}`}
                    data-testid={`push-open-${push.pushId}`}
                    className="mt-2 inline-flex min-h-11 items-center text-sm underline"
                  >
                    查看详情
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
