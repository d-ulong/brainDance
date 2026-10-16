"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  SessionLoadError,
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  Toast,
} from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import { fetchPointsBalance } from "@/lib/client/m2-api";
import {
  createCatalogItem,
  createRedemption,
  fetchRedemptionCatalog,
  fetchRedemptions,
  redemptionStatusLabel,
  updateCatalogItem,
  type CatalogItemDto,
  type RedemptionDto,
} from "@/lib/client/m6-api";

export default function ParentOwnRedemptionPage() {
  const [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const router = useRouter();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [records, setRecords] = useState<RedemptionDto[]>([]);
  const [confirming, setConfirming] = useState<CatalogItemDto | null>(null);
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("20");
  const [editing, setEditing] = useState<CatalogItemDto | null>(null);

  const load = useCallback(async (id: string) => {
    const [points, items, history] = await Promise.all([
      fetchPointsBalance(id),
      fetchRedemptionCatalog(id),
      fetchRedemptions(id),
    ]);
    setBalance(points.balance);
    setCatalog(items.items);
    setRecords(history.redemptions);
  }, []);

  useEffect(() => {
    setSessionFailed(false);
    setLoading(true);
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      setSubjectId(session.userId);
      try {
        await load(session.userId);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "无法加载个人兑换，请重试");
      } finally {
        setLoading(false);
      }
    })().catch(() => {
      setSessionFailed(true);
      setLoading(false);
    });
  }, [load, router, sessionAttempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!subjectId) return;
    setBusy(true);
    try {
      const body = { title: title.trim(), cost: Number(cost) };
      if (editing) await updateCatalogItem(subjectId, editing.id, body);
      else await createCatalogItem(subjectId, body);
      setEditing(null);
      setTitle("");
      setCost("20");
      await load(subjectId);
      setMessage("个人奖励已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!subjectId || !confirming) return;
    setBusy(true);
    try {
      await createRedemption(subjectId, confirming.id);
      setConfirming(null);
      await load(subjectId);
      setMessage("兑换成功，积分已扣除");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "兑换失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: CatalogItemDto) {
    if (!subjectId) return;
    setBusy(true);
    try {
      await updateCatalogItem(subjectId, item.id, { active: !item.active });
      await load(subjectId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  if (sessionFailed)
    return (
      <PageShell title="加载失败" hideTabs>
        <SessionLoadError
          onRetry={() => {
            setSessionFailed(false);
            setLoading(true);
            setSessionAttempt((attempt) => attempt + 1);
          }}
        />
      </PageShell>
    );
  return (
    <PageShell title="我的积分与兑换" showLogout>
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      {loading ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          <section className="bd-panel">
            <h2 className="text-lg font-bold">我的积分 {balance ?? "—"}</h2>
            <p className="mt-2 text-sm text-[var(--bd-muted)]">
              完成个人计划获得积分。兑换自己的奖励时，由你确认并立即扣分。
            </p>
            {balance === null && subjectId ? (
              <SecondaryButton
                onClick={() => void load(subjectId).catch(() => setError("加载失败，请重试"))}
              >
                重新加载
              </SecondaryButton>
            ) : null}
          </section>
          <section className="bd-panel">
            <h2 className="mb-3 text-lg font-bold">{editing ? "修改个人奖励" : "添加个人奖励"}</h2>
            <form className="grid gap-3" onSubmit={(event) => void save(event)}>
              <Field label="奖励名称">
                <TextInput
                  required
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="所需积分">
                <TextInput
                  type="number"
                  required
                  min={1}
                  step={1}
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                />
              </Field>
              <PrimaryButton type="submit" disabled={busy || !subjectId}>
                {busy ? "保存中…" : "保存奖励"}
              </PrimaryButton>
              {editing ? (
                <SecondaryButton
                  onClick={() => {
                    setEditing(null);
                    setTitle("");
                    setCost("20");
                  }}
                >
                  取消修改
                </SecondaryButton>
              ) : null}
            </form>
          </section>
          <section className="bd-panel">
            <h2 className="text-lg font-bold">个人奖励</h2>
            {catalog.length ? (
              <ul className="mt-3 space-y-3">
                {catalog.map((item) => (
                  <li key={item.id} className="rounded-2xl border border-[var(--bd-border)] p-3">
                    <strong>{item.title}</strong>
                    <p>
                      {item.cost} 分 · {item.active ? "可兑换" : "已停用"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <PrimaryButton
                        fullWidth={false}
                        disabled={busy || !item.active || balance === null || balance < item.cost}
                        onClick={() => setConfirming(item)}
                      >
                        兑换
                      </PrimaryButton>
                      <SecondaryButton
                        disabled={busy}
                        onClick={() => {
                          setEditing(item);
                          setTitle(item.title);
                          setCost(String(item.cost));
                        }}
                      >
                        修改
                      </SecondaryButton>
                      <SecondaryButton disabled={busy} onClick={() => void toggle(item)}>
                        {item.active ? "停用" : "启用"}
                      </SecondaryButton>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm">添加一个只属于你的奖励吧。</p>
            )}
          </section>
          <section className="bd-panel">
            <h2 className="text-lg font-bold">兑换记录</h2>
            {records.length ? (
              <ul className="mt-3 space-y-2">
                {records.map((record) => (
                  <li key={record.id}>
                    {catalog.find((item) => item.id === record.catalogItemId)?.title ?? "历史奖励"}{" "}
                    · {record.costSnapshot} 分 · {redemptionStatusLabel(record.status)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm">还没有兑换记录。</p>
            )}
          </section>
        </div>
      )}
      {confirming ? (
        <ConfirmDialog
          title="确认个人兑换"
          message={`兑换“${confirming.title}”将立即扣除你本人的 ${confirming.cost} 分。`}
          confirmLabel={busy ? "兑换中…" : "确认并扣分"}
          onClose={() => {
            if (!busy) setConfirming(null);
          }}
          onConfirm={() => {
            if (!busy) void redeem();
          }}
        />
      ) : null}
    </PageShell>
  );
}
