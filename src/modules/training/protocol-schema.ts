export function isSafePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isFiniteEventTime(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
