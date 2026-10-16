import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isRegisteredOutboxEvent } from "@/modules/outbox/event-registry";
import { FAMILY_CONTENT_EVENT_TYPES } from "@/modules/family-content/constants";

function sourceFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(path.join(root, entry.name))
        : entry.name.endsWith(".ts")
          ? [path.join(root, entry.name)]
          : [],
    );
}
function eventTypes(expression: ts.Expression): string[] {
  if (ts.isStringLiteral(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression))
    return [...eventTypes(expression.whenTrue), ...eventTypes(expression.whenFalse)];
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.expression.getText() === "FAMILY_CONTENT_EVENT_TYPES"
  )
    return [
      FAMILY_CONTENT_EVENT_TYPES[expression.name.text as keyof typeof FAMILY_CONTENT_EVENT_TYPES],
    ];
  throw new Error(`Outbox producer must declare auditable event type: ${expression.getText()}`);
}
describe("outbox producer coverage", () => {
  it("every emitted event has a consumer or explicit audit-only delivery", () => {
    const events = new Set<string>();
    for (const filename of sourceFiles(path.resolve("src/modules"))) {
      const source = ts.createSourceFile(
        filename,
        fs.readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === "appendOutboxEvent" &&
          node.arguments[1] &&
          ts.isObjectLiteralExpression(node.arguments[1])
        ) {
          const property = node.arguments[1].properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === "eventType",
          );
          if (property && ts.isPropertyAssignment(property))
            for (const type of eventTypes(property.initializer)) events.add(type);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(events.size).toBeGreaterThan(30);
    for (const type of events) expect(isRegisteredOutboxEvent(type, 1), type).toBe(true);
  });
  it("rejects unknown event versions and event types", () => {
    expect(isRegisteredOutboxEvent("goal.created", 2)).toBe(false);
    expect(isRegisteredOutboxEvent("unknown", 1)).toBe(false);
  });
});
