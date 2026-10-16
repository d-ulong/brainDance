import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  factVersions,
  planItemRules,
  scheduleTaskExecutions,
  planScheduleSlots,
  plans,
  pointLedgerEntries,
  scheduleItems,
  settlements,
  users,
} from "@/db/schema";
import { effectiveStatus } from "@/modules/schedule/effective-status";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";
import {
  executionEditDeadline,
  readChecklist,
  readPomodoro,
  type ChecklistTask,
  type Pomodoro,
} from "@/modules/schedule/execution-state";
import {
  completionWindowEnd,
  isWithinCompletionWindow,
} from "@/modules/time-policy/completion-window";
import { ageInYearsAt } from "@/modules/time-policy/resolve-age-band";

function maximumPointsFromEntry(entry: Record<string, unknown>) {
  const points = entry.points;
  if (!points || typeof points !== "object") return 0;
  return Math.max(
    0,
    ...Object.values(points).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    ),
  );
}
export type CurrentFormalPlanDto = {
  planId: string;
  versionId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  localTime: string | null;
};
export async function queryCurrentFormalPlan(
  db: Database,
  studentId: string,
): Promise<CurrentFormalPlanDto | null> {
  await assertSubjectAccess(db, studentId, "read");
  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(eq(plans.studentId, studentId), eq(plans.planKind, "formal"), eq(plans.status, "active")),
    )
    .limit(1);
  if (!plan?.currentVersion) return null;
  const [slot] = await db
    .select({ localTime: planScheduleSlots.localTime })
    .from(planScheduleSlots)
    .where(
      and(
        eq(planScheduleSlots.planVersionId, plan.currentVersion),
        eq(planScheduleSlots.slotKey, "default"),
      ),
    )
    .limit(1);
  return {
    planId: plan.id,
    versionId: plan.currentVersion,
    title: plan.title,
    description: plan.description,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: plan.status,
    localTime: slot?.localTime?.slice(0, 5) ?? null,
  };
}
export type ScheduleItemDto = {
  id: string;
  planId: string;
  planVersionId: string;
  studentId: string;
  ownerId: string;
  familyDate: string;
  slotKey: string;
  scheduledAt: Date;
  status: string;
  source: string;
  occurrenceKey: string;
  effectiveStatus: string;
  title: string;
  planTitle: string;
  priority: number;
  startedAt: Date | null;
  completedAt: Date | null;
  actualDurationMinutes: number | null;
  description: string | null;
  pointsEarned: number | null;
  pointsRuleLabel: string | null;
  maximumPoints: number;
  durationMinutes: number | null;
  taskType: "normal" | "homework" | "exercise";
  completionStandard: string | null;
  checklist: ChecklistTask[];
  pomodoro: Pomodoro;
  executionRevision: number;
  executionAllCompleted: boolean;
  canStart: boolean;
  canComplete: boolean;
  canEditExecution: boolean;
  canCorrect: boolean;
  completionDeadline: Date;
  editDeadline: Date;
  suppressedByScheduleItemId: string | null;
};
const POINTS_RULE_LABELS: Record<string, string> = {
  onTimeWithin: "按时且时长内",
  onTimeOver: "按时但超时",
  lateWithin: "迟开始且时长内",
  lateOver: "迟开始且超时",
  incomplete: "未完成",
};
function labelForPointsExplanation(explanation: string | null | undefined): string | null {
  if (!explanation) return null;
  const matched = explanation.match(/Plan item ([a-zA-Z]+):/);
  return matched?.[1] ? (POINTS_RULE_LABELS[matched[1]] ?? explanation) : explanation;
}
export type QueryScheduleItemsInput = {
  studentId: string;
  from: string;
  to: string;
  actorId?: string;
  actorRole?: "parent" | "student";
  now?: Date;
};

/** Read-only: expired state is projected consistently; all writes belong to commands/Worker. */
export async function queryScheduleItems(
  db: Database,
  input: QueryScheduleItemsInput,
): Promise<ScheduleItemDto[]> {
  const now = input.now ?? new Date();
  await assertSubjectAccess(db, input.studentId, "read", now);
  const [subject] = await db
    .select({ role: users.role, birthDate: users.birthDate })
    .from(users)
    .where(eq(users.id, input.studentId))
    .limit(1);
  const subjectCanWrite =
    subject?.role !== "student" ||
    Boolean(
      subject.birthDate && ageInYearsAt(new Date(`${subject.birthDate}T00:00:00+08:00`), now) < 19,
    );
  const rows = await db
    .select({
      item: scheduleItems,
      planTitle: plans.title,
      rule: planItemRules,
      taskExecution: scheduleTaskExecutions,
      completionFact: factVersions,
      pointsEarned: pointLedgerEntries.amount,
      pointsExplanation: pointLedgerEntries.explanation,
    })
    .from(scheduleItems)
    .innerJoin(plans, eq(plans.id, scheduleItems.planId))
    .leftJoin(planItemRules, eq(planItemRules.scheduleItemId, scheduleItems.id))
    .leftJoin(scheduleTaskExecutions, eq(scheduleTaskExecutions.scheduleItemId, scheduleItems.id))
    .leftJoin(
      factVersions,
      and(
        eq(factVersions.scheduleItemId, scheduleItems.id),
        eq(factVersions.factKey, "schedule.completed"),
        sql`NOT EXISTS (SELECT 1 FROM fact_versions successor WHERE successor.supersedes_fact_version_id = ${factVersions.id})`,
      ),
    )
    .leftJoin(
      settlements,
      and(eq(settlements.factVersionId, factVersions.id), eq(settlements.result, "reward")),
    )
    .leftJoin(pointLedgerEntries, eq(pointLedgerEntries.settlementId, settlements.id))
    .where(
      and(
        eq(scheduleItems.studentId, input.studentId),
        gte(scheduleItems.familyDate, input.from),
        lte(scheduleItems.familyDate, input.to),
        ne(scheduleItems.status, "cancelled"),
      ),
    );
  return rows.map(
    ({ item, planTitle, rule, taskExecution, completionFact, pointsEarned, pointsExplanation }) => {
      const rawEntry = item.planSnapshot?.entry ?? rule?.entry;
      const entry =
        rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : {};
      const taskType =
        entry.taskType === "homework" || entry.taskType === "exercise" ? entry.taskType : "normal";
      const factStart =
        typeof completionFact?.value.started_at === "string"
          ? new Date(completionFact.value.started_at)
          : null;
      const startedAt =
        item.status === "completed"
          ? (factStart ?? rule?.startedAt ?? null)
          : (rule?.startedAt ?? null);
      const completedAt = completionFact?.occurredAt ?? null;
      const actualDurationMinutes =
        typeof completionFact?.value.duration_minutes === "number"
          ? completionFact.value.duration_minutes
          : null;
      const writable =
        subjectCanWrite &&
        !item.suppressedByScheduleItemId &&
        (!input.actorId || input.actorId === item.studentId || input.actorRole === "parent");
      const pendingWindow =
        item.status === "pending" && isWithinCompletionWindow(item.familyDate, now);
      const editDeadline = executionEditDeadline(item.familyDate, input.actorRole ?? "student");
      const canCorrect = Boolean(writable && item.status === "completed" && now < editDeadline);
      const savedSnapshot = completionFact?.value.execution;
      const snapshot =
        savedSnapshot && typeof savedSnapshot === "object"
          ? (savedSnapshot as Record<string, unknown>)
          : null;
      return {
        id: item.id,
        planId: item.planId,
        planVersionId: item.planVersionId,
        studentId: item.studentId,
        ownerId: item.ownerId,
        familyDate: item.familyDate,
        slotKey: item.slotKey,
        scheduledAt: item.scheduledAt,
        status: item.status,
        source: item.source,
        occurrenceKey: item.occurrenceKey,
        effectiveStatus: effectiveStatus(
          { status: item.status, familyDate: item.familyDate, startedAt },
          now,
        ),
        title: typeof entry.title === "string" ? entry.title : planTitle,
        planTitle,
        priority: item.priority,
        startedAt,
        completedAt,
        actualDurationMinutes,
        description: typeof entry.description === "string" ? entry.description : null,
        pointsEarned: pointsEarned ?? null,
        pointsRuleLabel: labelForPointsExplanation(pointsExplanation),
        maximumPoints: maximumPointsFromEntry(entry),
        durationMinutes: typeof entry.durationMinutes === "number" ? entry.durationMinutes : null,
        taskType,
        completionStandard:
          typeof entry.completionStandard === "string" ? entry.completionStandard : null,
        checklist: readChecklist(
          snapshot?.checklist ?? taskExecution?.checklist ?? entry.checklist,
        ),
        pomodoro: readPomodoro(snapshot?.pomodoro ?? taskExecution?.pomodoro),
        executionRevision: taskExecution?.revision ?? 0,
        executionAllCompleted: snapshot?.all_completed !== false,
        canStart: Boolean(writable && pendingWindow && rule && !startedAt),
        canComplete: Boolean(writable && pendingWindow),
        canEditExecution: Boolean(writable && (pendingWindow || canCorrect)),
        canCorrect,
        completionDeadline: completionWindowEnd(item.familyDate),
        editDeadline,
        suppressedByScheduleItemId: item.suppressedByScheduleItemId,
      };
    },
  );
}
