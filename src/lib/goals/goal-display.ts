import type { GoalDto } from "@/lib/client/m2-api";

export const goalStatusLabel: Record<GoalDto["status"], string> = {
  pending_approval: "待批准",
  active: "进行中",
  completed: "已完成 · 待评定",
  succeeded: "已评定 · 达成",
  failed: "已评定 · 未达成",
};

export function goalCardTone(status: GoalDto["status"]): string {
  switch (status) {
    case "pending_approval":
      return "bd-goal-card bd-goal-card-pending";
    case "active":
      return "bd-goal-card bd-goal-card-active";
    case "completed":
      return "bd-goal-card bd-goal-card-completed";
    case "succeeded":
      return "bd-goal-card bd-goal-card-succeeded";
    case "failed":
      return "bd-goal-card bd-goal-card-failed";
  }
}
