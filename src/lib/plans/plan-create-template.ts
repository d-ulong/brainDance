import { blankPlanEntry, toPlanDefinition } from "@/lib/plans/plan-draft-serialization";
import { type PlanLibraryDto } from "@/lib/client/m2-api";

export function planLibraryCreateTemplate(startDate: string): PlanLibraryDto {
  const definition = toPlanDefinition("", "", startDate, [blankPlanEntry(0)]);
  return {
    id: "__create__",
    revision: 0,
    priority: 0,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    ownerId: "",
    bindings: [],
    canEdit: true,
    definition,
  };
}
