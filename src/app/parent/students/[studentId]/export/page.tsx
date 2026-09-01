"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createExportJob,
  downloadExportArtifact,
  exportStatusLabel,
  fetchExportJobs,
  processExportJob,
  readStoredExportToken,
  storeExportToken,
  type ExportJobDto,
} from "@/lib/client/m6-api";

export default function ParentExportPage({ params }: { params: Promise<{ studentId: string }> }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ExportJobDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setError(null);
    setForbidden(false);
    try {
      const result = await fetchExportJobs();
      const sid = studentId;
      setJobs(sid ? result.jobs.filter((job) => job.studentId === sid) : result.jobs);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      throw err;
    }
  }, [studentId]);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const sid = resolved.studentId;
      setStudentId(sid);

      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }

      try {
        const result = await fetchExportJobs();
        setJobs(result.jobs.filter((job) => job.studentId === sid));
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(err instanceof ApiError ? err.message : "加载导出任务失败");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [params, router]);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建导出任务失败");
    } finally {
      setCreating(false);
    }
  }

  async function onProcess(jobId: string) {
    setProcessingId(jobId);
    setActionMessage(null);
    setError(null);
    try {
      const result = await processExportJob(jobId);
      if (result.downloadTokenPlaintext) {
        storeExportToken(jobId, result.downloadTokenPlaintext);
      }
      setActionMessage(
        result.status === "ready"
          ? "导出文件已就绪，可下载（令牌 24 小时内有效，仅可下载一次）"
          : `任务状态：${exportStatusLabel(result.status)}`,
      );
      await loadJobs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "处理导出任务失败");
    } finally {
      setProcessingId(null);
    }
  }

  async function onDownload(jobId: string) {
    const token = readStoredExportToken(jobId);
    if (!token) {
      setError("下载令牌不可用，请重新生成导出文件");
      return;
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

  if (loading) {
    return (
      <PageShell title="数据导出">
        <LoadingState />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell title="数据导出" backHref="/parent/students" showLogout>
        <Alert tone="error" data-testid="parent-forbidden">
          无权限访问该学生数据。
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="数据导出"
      subtitle="导出当前授权范围内的学生数据"
      backHref="/parent/students"
      showLogout
    >
      {actionMessage ? (
        <Alert tone="success" data-testid="parent-export-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" data-testid="parent-export-error">
          {error}
        </Alert>
      ) : null}

      <PrimaryButton
        disabled={creating}
        onClick={() => void onCreateExport()}
        data-testid="parent-create-export-button"
      >
        {creating ? "创建中…" : "请求导出学生数据"}
      </PrimaryButton>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">导出任务</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500" data-testid="parent-export-jobs-empty">
            暂无导出任务。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-lg border border-neutral-200 p-3"
                data-testid={`parent-export-job-${job.id}`}
              >
                <p className="text-sm">
                  状态：
                  <span data-testid={`parent-export-status-${job.id}`}>
                    {exportStatusLabel(job.status)}
                  </span>
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {job.status === "pending" || job.status === "processing" ? (
                    <PrimaryButton
                      disabled={processingId === job.id}
                      onClick={() => void onProcess(job.id)}
                      data-testid={`parent-process-export-${job.id}`}
                    >
                      {processingId === job.id ? "生成中…" : "生成导出文件"}
                    </PrimaryButton>
                  ) : null}
                  {job.status === "ready" && !job.consumedAt ? (
                    <PrimaryButton
                      disabled={downloadingId === job.id}
                      onClick={() => void onDownload(job.id)}
                      data-testid={`parent-download-export-${job.id}`}
                    >
                      {downloadingId === job.id ? "下载中…" : "下载导出文件"}
                    </PrimaryButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
