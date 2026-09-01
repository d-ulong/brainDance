/**
 * Shared capacity tier parsing and metric envelope helpers.
 * Metrics that cannot be measured must use unavailable + reason (never bare null).
 */

export const VALID_CAPACITY_TIERS = [100, 1000, 10000] as const;
export type CapacityTier = (typeof VALID_CAPACITY_TIERS)[number];

export type CapacityMetricValue =
  { status: "measured"; value: unknown } | { status: "unavailable"; reason: string };

export function parseCapacityTier(argv: string[]): CapacityTier {
  const tierIndex = argv.indexOf("--tier");
  if (tierIndex === -1 || !argv[tierIndex + 1]) {
    throw new Error("Usage: pnpm capacity:synthetic -- --tier 100|1000|10000");
  }
  const tier = Number(argv[tierIndex + 1]);
  if (!VALID_CAPACITY_TIERS.includes(tier as CapacityTier)) {
    throw new Error(`Invalid tier: ${tier}. Must be one of ${VALID_CAPACITY_TIERS.join(", ")}`);
  }
  return tier as CapacityTier;
}

export function unavailableMetric(reason: string): CapacityMetricValue {
  return { status: "unavailable", reason };
}

export function assertCapacityResultShape(result: Record<string, unknown>): string[] {
  const required = [
    "tier",
    "connections",
    "queueDepth",
    "slowQueries",
    "export",
    "deletion",
    "resources",
    "totalElapsedMs",
  ];
  return required.filter((key) => !(key in result));
}
