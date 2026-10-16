import { getM3EventHandler } from "@/modules/outbox/m3-event-handlers";
import { getM6EventHandler } from "@/modules/data-lifecycle/m6-outbox-handlers";
import { getM7EventHandler } from "@/modules/family-content/m7-outbox-handlers";
import { isSupportedNoopEvent } from "@/modules/outbox/worker-constants";

/** Exact type/version coverage; unknown versions always fail closed. */
export function isRegisteredOutboxEvent(type: string, version: number): boolean {
  return Boolean(
    getM3EventHandler(type, version) ||
    getM6EventHandler(type, version) ||
    getM7EventHandler(type, version) ||
    isSupportedNoopEvent(type, version),
  );
}
