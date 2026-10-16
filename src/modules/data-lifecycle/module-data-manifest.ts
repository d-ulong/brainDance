import { sql } from "drizzle-orm";
import type { Database } from "@/db";

/** Keep scoring/lineage fields, remove human-authored descriptions in deletion only. */
export function redactExecutionBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactExecutionBody);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      [
        "title",
        "content",
        "body",
        "notes",
        "description",
        "reason",
        "label",
        "completionStandard",
      ].includes(key)
        ? ""
        : redactExecutionBody(child),
    ]),
  );
}

/** Idempotent deletion/tombstone replay manifest. Shared parent definitions remain
 * available to other subjects; per-subject snapshots and notes are always erased.
 * Account deletion is the sole exception to ordinary immutable-body retention;
 * numeric evidence, version IDs, amounts and timestamps remain reconstructible. */
export async function purgeNewModuleBodiesForStudent(
  tx: Database,
  studentId: string,
): Promise<void> {
  await tx.execute(
    sql`UPDATE goal_notes SET body = '' WHERE assignment_id IN (SELECT id FROM goal_assignments WHERE subject_id = ${studentId}::uuid)`,
  );
  await tx.execute(
    sql`UPDATE goal_assignments SET actual_gift = NULL, evaluation_reason = NULL WHERE subject_id = ${studentId}::uuid`,
  );
  await tx.execute(
    sql`UPDATE goal_definitions SET content = '', notes = NULL, expected_gift = NULL WHERE id IN (SELECT definition_id FROM goal_assignments WHERE subject_id = ${studentId}::uuid) AND NOT EXISTS (SELECT 1 FROM goal_assignments a WHERE a.definition_id = goal_definitions.id AND a.subject_id <> ${studentId}::uuid)`,
  );
  await tx.execute(
    sql`UPDATE manual_point_adjustments SET reason = '[deleted]' WHERE student_id = ${studentId}::uuid`,
  );
  await tx.execute(
    sql`UPDATE point_ledger_entries SET explanation = '[deleted]' WHERE student_id = ${studentId}::uuid`,
  );
  await tx.execute(sql`UPDATE goals SET title = '' WHERE student_id = ${studentId}::uuid`);
  await tx.execute(
    sql`UPDATE plans SET title = '', description = NULL WHERE student_id = ${studentId}::uuid`,
  );
  await tx.execute(
    sql`UPDATE schedule_task_executions SET checklist = '[]'::jsonb, pomodoro = '{}'::jsonb WHERE schedule_item_id IN (SELECT id FROM schedule_items WHERE student_id = ${studentId}::uuid)`,
  );
  await tx.execute(
    sql`DELETE FROM schedule_execution_commands WHERE schedule_item_id IN (SELECT id FROM schedule_items WHERE student_id = ${studentId}::uuid)`,
  );
  // Results may contain execution or descriptive snapshots. They are not facts.
  await tx.execute(sql`DELETE FROM goal_commands WHERE actor_id = ${studentId}::uuid`);
  await tx.execute(sql`DELETE FROM plan_library_commands WHERE actor_id = ${studentId}::uuid`);
  const groups = [
    {
      table: "schedule_items",
      id: "id",
      body: "plan_snapshot",
      where: sql`student_id = ${studentId}::uuid`,
    },
    {
      table: "plan_item_rules",
      id: "schedule_item_id",
      body: "entry",
      where: sql`schedule_item_id IN (SELECT id FROM schedule_items WHERE student_id = ${studentId}::uuid)`,
    },
    {
      table: "plan_activations",
      id: "id",
      body: "definition",
      where: sql`student_id = ${studentId}::uuid`,
    },
    {
      table: "plan_library",
      id: "id",
      body: "definition",
      where: sql`owner_id = ${studentId}::uuid`,
    },
    {
      table: "plan_versions",
      id: "id",
      body: "schedule_rule",
      where: sql`plan_id IN (SELECT id FROM plans WHERE student_id = ${studentId}::uuid)`,
    },
    {
      table: "fact_versions",
      id: "id",
      body: "value",
      where: sql`student_id = ${studentId}::uuid`,
    },
  ];
  for (const group of groups) {
    // Identifiers are a closed manifest above, never caller input.
    const rows = await tx.execute(
      sql`SELECT ${sql.identifier(group.id)} AS id, ${sql.identifier(group.body)} AS body FROM ${sql.identifier(group.table)} WHERE ${group.where}`,
    );
    for (const row of rows as unknown as Array<{ id: string; body: unknown }>) {
      const redacted = redactExecutionBody(row.body);
      await tx.execute(
        sql`UPDATE ${sql.identifier(group.table)} SET ${sql.identifier(group.body)} = ${JSON.stringify(redacted)}::jsonb WHERE ${sql.identifier(group.id)} = ${row.id}::uuid`,
      );
    }
  }
  await tx.execute(
    sql`UPDATE fact_versions SET correction_reason = CASE WHEN correction_reason IS NULL THEN NULL ELSE '[deleted]' END WHERE student_id = ${studentId}::uuid`,
  );
}
