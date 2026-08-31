import { toFamilyDate } from "@/modules/time-policy/to-family-date";

/** Stable YYYY-MM business month in Asia/Shanghai. */
export function toFamilyMonth(utc: Date = new Date()): string {
  return toFamilyDate(utc).slice(0, 7);
}
