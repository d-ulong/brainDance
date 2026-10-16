"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  Alert,
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  SecondaryButton,
  SessionLoadError,
  TextInput,
} from "@/components/ui/page-shell";
import { ApiError, fetchSession, newIdempotencyKey, type SessionInfo } from "@/lib/client/api";
import {
  listAdminAccounts,
  resetAccountPassword,
  type AdminAccount,
  type AdminAccountList,
} from "@/lib/client/admin-accounts";

const roles = { admin: "管理员", parent: "家长", student: "学生" };
const statuses = {
  active: "正常",
  pending_verification: "待验证",
  locked: "登录锁定",
  disabled: "已禁用",
};

export default function AdminAccountsPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AdminAccountList | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ target: AdminAccount; key: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [result, setResult] = useState<{ account: string; password?: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessionFailed(false);
    void fetchSession()
      .then((value) => {
        if (cancelled) return;
        if (!value) router.replace("/login");
        else if (value.mustChangePassword) router.replace("/change-password");
        else if (value.role !== "admin") router.replace("/");
        else setSession(value);
      })
      .catch(() => {
        if (!cancelled) setSessionFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listAdminAccounts({ page, search, role }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof ApiError ? failure.message : "账号列表加载失败，请重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, page, search, role, refresh]);

  function closeResult() {
    setResult(null);
    setCopyMessage(null);
  }
  async function confirmReset() {
    if (!pending || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setResetError(null);
    try {
      const response = await resetAccountPassword(pending.target, pending.key);
      setResult({ account: pending.target.account, password: response.temporaryPassword });
      setPending(null);
      setRefresh((value) => value + 1);
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (failure.code === "STATE_CONFLICT" || failure.code === "IDEMPOTENCY_CONFLICT")
      ) {
        setPending(null);
        setError("账号已发生变化，本次未重置。请刷新后核对目标，再重新操作。");
        // Refresh explicitly, keeping the conflict visible until the administrator acts.
      } else
        setResetError(
          failure instanceof ApiError
            ? failure.message
            : "未能确认重置结果。可重试同一次请求；如已完成，不会再次重置，也不会重新显示临时密码。",
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (sessionFailed)
    return (
      <PageShell title="加载失败" hideTabs>
        <SessionLoadError onRetry={() => setAttempt((value) => value + 1)} />
      </PageShell>
    );
  return (
    <PageShell title="账号管理" subtitle="查看成员账号，为其他成员重置临时密码。" showLogout>
      {!session ? (
        <LoadingState />
      ) : (
        <>
          <form
            className="bd-panel grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
              setRefresh((value) => value + 1);
            }}
          >
            <Field label="账号或姓名">
              <TextInput
                data-testid="accounts-search"
                value={searchInput}
                maxLength={100}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="输入账号或显示名"
              />
            </Field>
            <Field label="角色">
              <select
                data-testid="accounts-role"
                className="bd-input min-h-11 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] px-3 text-[var(--bd-text)]"
                value={role}
                onChange={(event) => {
                  setRole(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部角色</option>
                {Object.entries(roles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <PrimaryButton type="submit" fullWidth={false}>
              查询
            </PrimaryButton>
          </form>
          {error ? (
            <Alert tone="error" role="alert">
              {error}
              <SecondaryButton className="ml-2" onClick={() => setRefresh((value) => value + 1)}>
                刷新列表
              </SecondaryButton>
            </Alert>
          ) : null}
          {loading ? (
            <LoadingState label="正在加载账号…" />
          ) : data && !error ? (
            <>
              <p className="text-sm text-[var(--bd-muted)]" role="status">
                共 {data.total} 个账号，第 {data.page} /{" "}
                {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
              </p>
              <div className="flex flex-col gap-3" data-testid="accounts-list">
                {data.items.length ? (
                  data.items.map((account) => (
                    <article
                      className="bd-panel flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                      key={account.userId}
                      data-testid={`account-row-${account.userId}`}
                    >
                      <div className="min-w-0">
                        <h2 className="font-bold break-words">
                          {account.displayName || "未设置姓名"}
                          {account.userId === session.userId ? "（本人）" : ""}
                        </h2>
                        <p
                          className="mt-1 text-sm break-all"
                          data-testid="managed-account-identifier"
                        >
                          {account.account}
                        </p>
                        <p className="mt-2 text-sm text-[var(--bd-muted)]">
                          {roles[account.role]} · {statuses[account.status]} ·{" "}
                          {account.mustChangePassword ? "下次登录需改密" : "密码已设置"}
                        </p>
                      </div>
                      {account.userId === session.userId ? (
                        <Link className="bd-inline-link shrink-0" href="/change-password">
                          修改本人密码 →
                        </Link>
                      ) : (
                        <SecondaryButton
                          className="shrink-0"
                          data-testid={`reset-password-${account.userId}`}
                          onClick={() => {
                            closeResult();
                            setResetError(null);
                            setPending({ target: account, key: newIdempotencyKey("admin-reset") });
                          }}
                        >
                          重置密码
                        </SecondaryButton>
                      )}
                    </article>
                  ))
                ) : (
                  <Alert>没有符合条件的账号。</Alert>
                )}
              </div>
              <div className="flex justify-between gap-3">
                <SecondaryButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  上一页
                </SecondaryButton>
                <SecondaryButton
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </SecondaryButton>
              </div>
            </>
          ) : null}
        </>
      )}
      {pending ? (
        <Modal
          title="确认重置此账号密码"
          layer="critical"
          closeOnEscape={!busy}
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <div className="text-[var(--bd-text)]">
            <p className="font-bold break-words">
              {pending.target.displayName || "未设置姓名"} · {roles[pending.target.role]}
            </p>
            <p className="mt-1 break-all">{pending.target.account}</p>
            <p className="mt-4 text-sm leading-6">
              重置后，旧密码和现有登录会话立即失效。系统生成临时密码，仅显示一次；该成员登录后必须设置自己的新密码。账号原有访问限制及管理员验证器保持有效。
            </p>
          </div>
          {resetError ? (
            <p role="alert" className="mt-4 text-sm text-[var(--bd-text)]">
              {resetError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <SecondaryButton disabled={busy} onClick={() => setPending(null)}>
              取消
            </SecondaryButton>
            <PrimaryButton
              fullWidth={false}
              disabled={busy}
              onClick={() => void confirmReset()}
              data-testid="confirm-password-reset"
            >
              {busy ? "重置中…" : resetError ? "重试本次重置" : "确认重置"}
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}
      {result ? (
        <Modal title="密码已重置" layer="critical" onClose={closeResult}>
          <div className="text-[var(--bd-text)]">
            <p className="break-all">账号：{result.account}</p>
            {result.password ? (
              <>
                <p className="mt-3 text-sm">请将临时密码交给该账号本人。关闭后无法再次查看。</p>
                <p
                  data-testid="temporary-password"
                  className="mt-4 rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] p-4 font-mono text-xl font-bold break-all select-all"
                >
                  {result.password}
                </p>
                <SecondaryButton
                  className="mt-3"
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setCopyMessage("复制不可用，请选中上方密码手动复制");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(result.password!)
                      .then(() => setCopyMessage("已复制临时密码"))
                      .catch(() => setCopyMessage("复制失败，请选中上方密码手动复制"));
                  }}
                >
                  复制临时密码
                </SecondaryButton>
                {copyMessage ? (
                  <p className="mt-2 text-sm" role="status">
                    {copyMessage}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm" role="status">
                本次请求此前已完成，临时密码不会重复显示。如未保存，请关闭此窗口，重新发起一次重置。
              </p>
            )}
            <p className="mt-4 text-sm text-[var(--bd-muted)]">
              成员登录后须设置新密码；管理员仍需验证器验证码。
            </p>
          </div>
          <SecondaryButton className="mt-5" onClick={closeResult}>
            已保存，关闭
          </SecondaryButton>
        </Modal>
      ) : null}
    </PageShell>
  );
}
