"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  deleteDailyReflection,
  fetchDailyReflection,
  fetchReflectionGrants,
  grantReflectionAccess,
  reflectionVisibilityLabel,
  revokeReflectionAccess,
  todayFamilyDate,
  upsertDailyReflection,
  type DailyReflectionDto,
  type ReflectionGrantDto,
} from "@/lib/client/m4-api";

export default function StudentReflectionPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reflection, setReflection] = useState<DailyReflectionDto | null>(null);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"normal" | "private">("normal");
  const [grants, setGrants] = useState<ReflectionGrantDto[]>([]);
  const [eligibleParents, setEligibleParents] = useState<
    Array<{ parentId: string; displayName: string }>
  >([]);
  const [saving, setSaving] = useState(false);

  const familyDate = todayFamilyDate();

  const loadReflection = useCallback(
    async (sid: string) => {
      setError(null);
      try {
        const data = await fetchDailyReflection(sid, familyDate);
        setReflection(data);
        setBody(data.body);
        setVisibility(data.visibility);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setReflection(null);
          setBody("");
          setVisibility("normal");
        } else {
          throw err;
        }
      }
    },
    [familyDate],
  );

  const loadGrants = useCallback(
    async (sid: string) => {
      try {
        const data = await fetchReflectionGrants(sid, familyDate);
        setGrants(data.grants);
        setEligibleParents(data.eligibleParents);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setGrants([]);
          setEligibleParents([]);
        } else {
          throw err;
        }
      }
    },
    [familyDate],
  );

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

      setStudentId(session.userId);
      try {
        await loadReflection(session.userId);
        await loadGrants(session.userId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载总结失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadGrants, loadReflection, router]);

  async function onSave() {
    if (!studentId) return;
    setSaving(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await upsertDailyReflection({
        studentId,
        body,
        visibility,
      });
      setReflection(result);
      setActionMessage(result.idempotentReplay ? "已保存（幂等回放）" : "总结已保存");
      await loadGrants(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!studentId) return;
    setSaving(true);
    setActionMessage(null);
    setError(null);
    try {
      await deleteDailyReflection(studentId, familyDate);
      setReflection(null);
      setBody("");
      setVisibility("normal");
      setGrants([]);
      setActionMessage("总结已删除");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function onGrant(parentId: string) {
    if (!studentId) return;
    setSaving(true);
    setActionMessage(null);
    setError(null);
    try {
      await grantReflectionAccess({ studentId, parentId });
      setActionMessage("已授权家长阅读");
      await loadGrants(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "授权失败");
    } finally {
      setSaving(false);
    }
  }

  async function onRevoke(parentId: string) {
    if (!studentId) return;
    setSaving(true);
    setActionMessage(null);
    setError(null);
    try {
      await revokeReflectionAccess({ studentId, parentId });
      setActionMessage("已撤销授权");
      await loadGrants(studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "撤销失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="今日总结">
        <LoadingState label="加载中…" />
      </PageShell>
    );
  }

  const grantedParentIds = new Set(grants.map((grant) => grant.parentId));
  const ungrantedParents = eligibleParents.filter(
    (parent) => !grantedParentIds.has(parent.parentId),
  );

  return (
    <PageShell title="今日总结">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        <p className="text-sm text-gray-600" data-testid="reflection-date">
          家庭日期：{familyDate}
        </p>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {actionMessage ? (
          <Alert tone="success" data-testid="reflection-action-message">
            {actionMessage}
          </Alert>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span>总结内容</span>
          <textarea
            data-testid="reflection-body-input"
            className="min-h-32 rounded border border-gray-300 p-2 text-base"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="写下今天的收获或感受…"
          />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend>可见性</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visibility"
              data-testid="reflection-visibility-normal"
              checked={visibility === "normal"}
              onChange={() => setVisibility("normal")}
            />
            普通（所有关联家长可读）
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visibility"
              data-testid="reflection-visibility-private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
              disabled={reflection?.visibility === "normal"}
            />
            私密（需逐家长授权）
          </label>
          {reflection?.visibility === "normal" ? (
            <p className="text-xs text-gray-500">普通总结不能改为私密</p>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton
            data-testid="reflection-save-button"
            disabled={saving || body.trim().length === 0}
            onClick={() => void onSave()}
          >
            {saving ? "保存中…" : "保存总结"}
          </PrimaryButton>
          {reflection ? (
            <PrimaryButton
              data-testid="reflection-delete-button"
              className="bg-neutral-200 text-neutral-900"
              disabled={saving}
              onClick={() => void onDelete()}
            >
              删除
            </PrimaryButton>
          ) : null}
        </div>

        {reflection?.visibility === "private" || visibility === "private" ? (
          <section className="flex flex-col gap-3 rounded border border-gray-200 p-3">
            <h2 className="text-base font-medium">私密授权管理</h2>
            <p className="text-xs text-gray-500">
              当前可见性：{reflectionVisibilityLabel(reflection?.visibility ?? visibility)}
            </p>

            {grants.length > 0 ? (
              <ul className="flex flex-col gap-2" data-testid="reflection-grant-list">
                {grants.map((grant) => (
                  <li
                    key={grant.parentId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span data-testid={`grant-parent-${grant.parentId}`}>{grant.displayName}</span>
                    <PrimaryButton
                      data-testid={`revoke-grant-${grant.parentId}`}
                      className="w-auto bg-neutral-200 px-3 py-2 text-neutral-900"
                      disabled={saving}
                      onClick={() => void onRevoke(grant.parentId)}
                    >
                      撤销
                    </PrimaryButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">尚未授权任何家长</p>
            )}

            {ungrantedParents.length > 0 ? (
              <ul className="flex flex-col gap-2" data-testid="reflection-eligible-parents">
                {ungrantedParents.map((parent) => (
                  <li
                    key={parent.parentId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>{parent.displayName}</span>
                    <PrimaryButton
                      data-testid={`grant-parent-${parent.parentId}`}
                      className="w-auto px-3 py-2"
                      disabled={saving || !reflection || reflection.visibility !== "private"}
                      onClick={() => void onGrant(parent.parentId)}
                    >
                      授权
                    </PrimaryButton>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
