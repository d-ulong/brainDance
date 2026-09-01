"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createExportJob,
  downloadExportArtifact,
  exportStatusLabel,
  fetchExportJobStatus,
  fetchExportJobs,
  issueExportDownloadToken,
  readStoredExportToken,
  storeExportToken,
  type ExportJobDto,
} from "@/lib/client/m6-api";

export default function StudentExportPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ExportJobDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setError(null);
    const result = await fetchExportJobs();
    setJobs(result.jobs);
    return result.jobs;
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      clearPollTimer();
      setPollingId(jobId);
      pollTimerRef.current = setInterval(() => {
        void (async () => {
          try {
            const status = await fetchExportJobStatus(jobId);
            await loadJobs();
            if (status.status === "ready") {
              setActionMessage("导出文件已就绪，可下载（令牌 24 小时内有效，仅可下载一次）");
              clearPollTimer();
              setPollingId(null);
            } else if (status.status === "failed" || status.status === "revoked") {
              setError(`导出任务${exportStatusLabel(status.status)}`);
              clearPollTimer();
              setPollingId(null);
            }
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "轮询导出状态失败");
            clearPollTimer();
            setPollingId(null);
          }
        })();
      }, 1500);
    },
    [clearPollTimer, loadJobs],
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
        const loaded = await loadJobs();
        const pending = loaded.find(
          (job) => job.status === "pending" || job.status === "processing",
        );
        if (pending) {
          startPolling(pending.id);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载导出任务失败");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      clearPollTimer();
    };
  }, [clearPollTimer, loadJobs, router, startPolling]);

  async function onCreateExport() {
    if (!studentId) return;
    setCreating(true);
    setActionMessage(null);
    setError(null);
    try {
      const result = await createExportJob(studentId);
      setActionMessage(
        result.idempotentReplay ? "导出任务已存在（幂等回放）" : "导出任务已创建，正在排队",
      );
      await loadJobs();
      startPolling(result.jobId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建导出任务失败");
    } finally {
      setCreating(false);
    }
  }

  async function onDownload(jobId: string) {
    let token = readStoredExportToken(jobId);
    if (!token) {
      try {
        const issued = await issueExportDownloadToken(jobId);
        storeExportToken(jobId, issued.token);
        token = issued.token;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "获取下载令牌失败");
        return;
      }
    }

    setDownloadingId(jobId);
    setActionMessage(null);
    setError(null);
    try {
      const content = await downloadExportArtifact(jobId, token);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `export-${jobId.slice(0, 8)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setActionMessage("导出文件已下载（令牌已消费）");
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloadingId(null);
    }
  }

  async function onRefreshStatus(jobId: string) {
    setPollingId(jobId);
    setError(null);
    try {
      const status = await fetchExportJobStatus(jobId);
      await loadJobs();
      if (status.status === "ready") {
        setActionMessage("导出文件已就绪，可下载（令牌 24 小时内有效，仅可下载一次）");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "刷新状态失败");
    } finally {
      setPollingId(null);
    }
  }

  if (loading) {
    return (
      <PageShell title="数据导出">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="数据导出" subtitle="导出本人允许范围内的数据" backHref="/" showLogout>
      {actionMessage ? (
        <Alert tone="success" data-testid="export-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" data-testid="export-error">
          {error}
        </Alert>
      ) : null}

      <PrimaryButton
        disabled={creating}
        onClick={() => void onCreateExport()}
        data-testid="create-export-button"
      >
        {creating ? "创建中…" : "请求导出我的数据"}
      </PrimaryButton>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">导出任务</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500" data-testid="export-jobs-empty">
            暂无导出任务。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-lg border border-neutral-200 p-3"
                data-testid={`export-job-${job.id}`}
              >
                <p className="text-sm break-all">任务 ID：{job.id}</p>
                <p className="text-sm">
                  状态：
                  <span data-testid={`export-status-${job.id}`}>
                    {exportStatusLabel(job.status)}
                  </span>
                  {pollingId === job.id ? "（轮询中…）" : ""}
                </p>
                {job.expiresAt ? (
                  <p className="text-sm text-neutral-600">
                    过期时间：{new Date(job.expiresAt).toLocaleString("zh-CN")}
                  </p>
                ) : null}
                {job.consumedAt ? (
                  <p className="text-sm text-neutral-600" data-testid={`export-consumed-${job.id}`}>
                    已于 {new Date(job.consumedAt).toLocaleString("zh-CN")} 下载
                  </p>
                ) : null}
                <div className="mt-3 flex flex-col gap-2">
                  {job.status === "ready" && !job.consumedAt ? (
                    <PrimaryButton
                      disabled={downloadingId === job.id}
                      onClick={() => void onDownload(job.id)}
                      data-testid={`download-export-${job.id}`}
                    >
                      {downloadingId === job.id ? "下载中…" : "下载导出文件"}
                    </PrimaryButton>
                  ) : null}
                  <PrimaryButton
                    disabled={pollingId === job.id}
                    onClick={() => void onRefreshStatus(job.id)}
                    data-testid={`refresh-export-${job.id}`}
                  >
                    刷新状态
                  </PrimaryButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
