import { describe, expect, it } from "vitest";
import { redactExecutionBody } from "@/modules/data-lifecycle/module-data-manifest";
import { sumLedgerAmounts } from "@/modules/settlement/ledger-order";
import { ageInYearsAt, resolveAgeBand } from "@/modules/time-policy/resolve-age-band";

describe("lifecycle retention boundaries", () => {
  it("redacts nested personal descriptions while keeping the scoring evidence", () => {
    const value = {
      started_at: "2026-10-16T10:00:00+08:00",
      execution: {
        checklist: [
          {
            id: "one",
            title: "private homework",
            completed: true,
            difficulty: "hard",
            durationMinutes: 10,
          },
        ],
        all_completed: true,
      },
      reason: "private reason",
    };
    expect(redactExecutionBody(value)).toEqual({
      ...value,
      reason: "",
      execution: {
        ...value.execution,
        checklist: [{ ...value.execution.checklist[0], title: "" }],
      },
    });
    expect(value.execution.checklist[0].title).toBe("private homework");
  });
  it("exactly sums reversed int32 minimum and rejects unsafe balance", () => {
    expect(sumLedgerAmounts([{ amount: -2147483648 }, { amount: 2147483648 }])).toBe(0);
    expect(() => sumLedgerAmounts([{ amount: Number.MAX_SAFE_INTEGER }, { amount: 1 }])).toThrow(
      "capacity",
    );
  });
  it("age-band changes the day after birthday, age eligibility closes at19", () => {
    const ninth = new Date("2017-10-16T00:00:00+08:00");
    expect(resolveAgeBand(ninth, new Date("2026-10-16T23:59:59+08:00"))).toBe("5-8");
    expect(resolveAgeBand(ninth, new Date("2026-10-17T00:00:00+08:00"))).toBe("9-12");
    expect(
      ageInYearsAt(new Date("2007-10-16T00:00:00+08:00"), new Date("2026-10-16T00:00:00+08:00")),
    ).toBe(19);
  });
});
