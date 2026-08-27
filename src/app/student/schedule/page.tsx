"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  completeScheduleItem,
  fetchScheduleItems,
  scheduleStatusLabel,
  todayFamilyDate,
  type ScheduleItemDto,
} from "@/lib/client/m2-api";

export default function StudentSchedulePage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [cardRefreshKey, setCardRefreshKey] = useState(0);

  const loadSchedule = useCallback(async (sid: string) => {
    setError(null);
    const today = todayFamilyDate();
    const result = await fetchScheduleItems(sid, today, today);
    setItems(result.items.filter((item) => item.familyDate === today));
  }, []);

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
        await loadSchedule(session.userId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载日程失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSchedule, router]);

  async function onCompleteItem(itemId: string) {
    if (!studentId) return;
    setCompletingId(itemId);
    setActionMessage(null);
    setError(null);
    try {
      const result = await completeScheduleItem(itemId);
      setActionMessage(
        result.idempotentReplay
          ? "任务已完成（幂等回放）"
          : `任务已完成，获得 +10 积分（${result.completionKind}）`,
      );
      await loadSchedule(studentId);
      setCardRefreshKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "完成任务失败");
    } finally {
      setCompletingId(null);
    }
  }

  if (loading) {
    return (
      <PageShell title="今日日程">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="今日日程" subtitle="完成今日任务获得积分" backHref="/" showLogout>
      {studentId ? <PointsTodayCard key={cardRefreshKey} studentId={studentId} /> : null}

      {actionMessage ? (
        <Alert tone="success" data-testid="complete-action-message">
          {actionMessage}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {items.length === 0 ? (
        <Alert tone="info">今日暂无日程任务。</Alert>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const canComplete = item.effectiveStatus === "pending";
            return (
              <li
                key={item.id}
                className="rounded-xl border border-neutral-300 bg-white p-4"
                data-testid={`student-schedule-item-${item.id}`}
              >
                <div className="flex flex-col gap-2">
                  <p className="font-medium break-words">{item.familyDate} 任务</p>
                  <p className="text-sm text-neutral-600">
                    计划时间：
                    {item.scheduledAt
                      ? new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZone: "Asia/Shanghai",
                        })
                      : "20:00"}
                  </p>
                  <p className="text-sm text-neutral-600">
                    状态：
                    <span data-testid={`item-status-${item.id}`}>
                      {scheduleStatusLabel(item.effectiveStatus)}
                    </span>
                  </p>
                  {canComplete ? (
                    <PrimaryButton
                      disabled={completingId === item.id}
                      onClick={() => void onCompleteItem(item.id)}
                      data-testid={`complete-button-${item.id}`}
                    >
                      {completingId === item.id ? "提交中…" : "完成"}
                    </PrimaryButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
