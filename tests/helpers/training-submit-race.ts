import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import {
  buildFullRebuildProjectionLockKey,
  buildSubmitCompetitionLockKey,
} from "@/modules/training/submit-competition-lock-key";
import type { TestDb } from "./db";

export { buildFullRebuildProjectionLockKey, buildSubmitCompetitionLockKey };

const DEFAULT_OBSERVATION_TIMEOUT_MS = 15000;
const DEFAULT_RUNNER_SETTLE_MS = 5000;

export const FIXED_POSITIVE_HASH_LOCK_KEY = "m5-lock-probe-1";
export const FIXED_NEGATIVE_HASH_LOCK_KEY = "m5-lock-probe-0";

export const INJECTED_GATE_UNLOCK_FAILURE_MESSAGE = "injected gate unlock failure";
export const INJECTED_GATE_CLOSE_FAILURE_MESSAGE = "injected gate close failure";
export const INJECTED_RUNNER_SETTLE_FAILURE_MESSAGE = "injected runner settle timeout";
export const INJECTED_MONITOR_CLOSE_FAILURE_MESSAGE = "injected monitor close failure";
export const INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE = "injected runner client close failure";

async function readBackendPid(client: postgres.Sql): Promise<number> {
  const rows = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return rows[0]!.pid;
}

export async function isPostgresBackendActive(
  monitor: postgres.Sql,
  pid: number,
): Promise<boolean> {
  const rows = await monitor<{ active: number }[]>`
    SELECT 1 AS active
    FROM pg_stat_activity
    WHERE pid = ${pid}
  `;
  return rows.length > 0;
}

type AdvisoryLockState = { waiting: number[]; holding: number[] };

export async function readSubmitAdvisoryLockState(
  monitor: postgres.Sql,
  pids: number[],
  lockKey: string,
): Promise<AdvisoryLockState> {
  const rows = await monitor<{ pid: number; granted: boolean }[]>`
    SELECT l.pid, l.granted
    FROM pg_locks l
    WHERE l.locktype = 'advisory'
      AND l.classid = ((hashtext(${lockKey})::bigint >> 32) & 4294967295)::oid
      AND l.objid = (hashtext(${lockKey})::bigint & 4294967295)::oid
      AND l.pid = ANY(${pids}::int[])
  `;

  const waiting: number[] = [];
  const holding: number[] = [];
  for (const row of rows) {
    if (row.granted) {
      holding.push(row.pid);
    } else {
      waiting.push(row.pid);
    }
  }
  return { waiting, holding };
}

async function waitForCondition(
  fn: () => Promise<boolean>,
  label: string,
  timeoutMs = DEFAULT_OBSERVATION_TIMEOUT_MS,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Single gate lifecycle phase; mutually exclusive, no contradictory booleans. */
type GateLockPhase = "unheld" | "holding" | "released" | "closed";

export type GateUnlockInjection = "throw" | "return_false" | "throw_undefined";

export type CleanupFailureInjection =
  | "runner_settle_timeout"
  | "monitor_close_throw"
  | "runner_client_close_throw"
  | "cleanup_throw_undefined";

type GateCloseInjectState = {
  consumed: boolean;
};

export type RaceCleanupTrace = {
  gateBackendPid: number;
  firstInjectedGateCloseAttempted: boolean;
  firstInjectedGateCloseFailed: boolean;
  finalGateCloseAttempted: boolean;
  finalGateCloseSucceeded: boolean;
};

class CleanupErrorAccumulator {
  private errors: unknown[] = [];
  private hasRecordedError = false;

  get hasError(): boolean {
    return this.hasRecordedError;
  }

  record(error: unknown): void {
    this.hasRecordedError = true;
    this.errors.push(error);
  }

  toError(): unknown {
    if (!this.hasRecordedError) {
      throw new Error("CleanupErrorAccumulator has no recorded errors");
    }
    if (this.errors.length === 1) {
      return this.errors[0];
    }
    return new AggregateError(this.errors, "Multiple cleanup errors during race teardown");
  }
}

async function queryAdvisoryUnlock(gate: postgres.Sql, lockKey: string): Promise<boolean> {
  const rows = await gate<{ pg_advisory_unlock: boolean }[]>`
    SELECT pg_advisory_unlock(hashtext(${lockKey})) AS pg_advisory_unlock
  `;
  return rows[0]?.pg_advisory_unlock ?? false;
}

async function terminateGateConnection(
  gate: postgres.Sql,
  gatePhase: { value: GateLockPhase },
): Promise<void> {
  if (gatePhase.value === "closed") {
    return;
  }
  await gate.end({ timeout: 5 });
  gatePhase.value = "closed";
}

async function closeGateWithInjectedAttemptThenFinalClose(
  gate: postgres.Sql,
  gatePhase: { value: GateLockPhase },
  injectOnce: boolean,
  injectState: GateCloseInjectState,
  accumulator: CleanupErrorAccumulator,
  trace: RaceCleanupTrace,
): Promise<void> {
  if (gatePhase.value === "closed") {
    return;
  }

  if (injectOnce && !injectState.consumed) {
    trace.firstInjectedGateCloseAttempted = true;
    injectState.consumed = true;
    trace.firstInjectedGateCloseFailed = true;
    accumulator.record(new Error(INJECTED_GATE_CLOSE_FAILURE_MESSAGE));
  }

  trace.finalGateCloseAttempted = true;
  try {
    await terminateGateConnection(gate, gatePhase);
    trace.finalGateCloseSucceeded = true;
  } catch (error) {
    accumulator.record(error);
  }
}

async function releaseGateLockOrClose(
  gate: postgres.Sql,
  lockKey: string,
  gatePhase: { value: GateLockPhase },
  accumulator: CleanupErrorAccumulator,
): Promise<void> {
  if (gatePhase.value !== "holding") {
    return;
  }

  try {
    const unlocked = await queryAdvisoryUnlock(gate, lockKey);
    if (unlocked) {
      gatePhase.value = "released";
      return;
    }
  } catch (error) {
    accumulator.record(error);
  }

  try {
    await terminateGateConnection(gate, gatePhase);
  } catch (error) {
    accumulator.record(error);
  }
}

async function waitForRunnersBounded<T>(
  submitPromises: Array<Promise<T>>,
  label: string,
  timeoutMs: number,
  injectRunnerSettleFailure: boolean,
): Promise<void> {
  if (submitPromises.length === 0) {
    return;
  }

  if (injectRunnerSettleFailure) {
    throw new Error(INJECTED_RUNNER_SETTLE_FAILURE_MESSAGE);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(submitPromises),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label} within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function endPostgresConnection(
  client: postgres.Sql,
  injectFailure?: "monitor_close_throw" | "runner_client_close_throw" | "cleanup_throw_undefined",
): Promise<void> {
  if (injectFailure === "monitor_close_throw") {
    throw new Error(INJECTED_MONITOR_CLOSE_FAILURE_MESSAGE);
  }
  if (injectFailure === "runner_client_close_throw") {
    throw new Error(INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE);
  }
  if (injectFailure === "cleanup_throw_undefined") {
    throw undefined;
  }
  await client.end({ timeout: 5 });
}

function combinePrimaryAndCleanupErrors(
  primaryError: unknown,
  cleanupError: unknown,
): AggregateError {
  return new AggregateError(
    [primaryError, cleanupError],
    "Concurrent submit race failed with cleanup error",
  );
}

async function unlockGateAfterObservation(
  gate: postgres.Sql,
  lockKey: string,
  gatePhase: { value: GateLockPhase },
  injectUnlock?: GateUnlockInjection,
): Promise<void> {
  if (injectUnlock === "throw") {
    throw new Error(INJECTED_GATE_UNLOCK_FAILURE_MESSAGE);
  }
  if (injectUnlock === "throw_undefined") {
    throw undefined;
  }

  const unlocked =
    injectUnlock === "return_false" ? false : await queryAdvisoryUnlock(gate, lockKey);

  if (!unlocked) {
    throw new Error(`Failed to release gated advisory lock for ${lockKey}`);
  }
  gatePhase.value = "released";
}

export type ConcurrentSubmitRaceOptions = {
  observationTimeoutMs?: number;
  runnerSettleMs?: number;
  /** Test-only: force gate unlock failure after observation succeeds. */
  injectGateUnlockFailure?: GateUnlockInjection;
  /** Test-only: force one injected gate close failure before final best-effort close. */
  injectGateCloseFailure?: boolean;
  /** Test-only: force a representative cleanup failure during teardown. */
  injectCleanupFailure?: CleanupFailureInjection;
  /** Test-only: read-only cleanup trace for deterministic close evidence. */
  onCleanupTrace?: (trace: RaceCleanupTrace) => void;
};

export async function runConcurrentSubmitsWithContentionEvidence<T>(
  lockKey: string,
  runners: Array<(db: TestDb) => Promise<T>>,
  options: ConcurrentSubmitRaceOptions = {},
): Promise<T[]> {
  if (runners.length < 2) {
    throw new Error("At least two concurrent submit runners are required");
  }

  const observationTimeoutMs = options.observationTimeoutMs ?? DEFAULT_OBSERVATION_TIMEOUT_MS;
  const runnerSettleMs = options.runnerSettleMs ?? DEFAULT_RUNNER_SETTLE_MS;
  const injectUnlock = options.injectGateUnlockFailure;
  const injectCleanupFailure = options.injectCleanupFailure;

  const gate = postgres(requireDatabaseUrl(), { max: 1 });
  const monitor = postgres(requireDatabaseUrl(), { max: 1 });
  const clients = runners.map(() => postgres(requireDatabaseUrl(), { max: 1 }));
  let submitPromises: Array<Promise<T>> = [];
  const gatePhase: { value: GateLockPhase } = { value: "unheld" };
  const closeInjectState: GateCloseInjectState = { consumed: false };
  const cleanupTrace: RaceCleanupTrace = {
    gateBackendPid: 0,
    firstInjectedGateCloseAttempted: false,
    firstInjectedGateCloseFailed: false,
    finalGateCloseAttempted: false,
    finalGateCloseSucceeded: false,
  };

  let result: T[] | undefined;
  let caughtPrimary = false;
  let primaryError: unknown;
  const cleanupAccumulator = new CleanupErrorAccumulator();

  try {
    await gate`SELECT pg_advisory_lock(hashtext(${lockKey}))`;
    gatePhase.value = "holding";
    cleanupTrace.gateBackendPid = await readBackendPid(gate);

    const pids: number[] = [];
    for (const client of clients) {
      pids.push(await readBackendPid(client));
    }

    submitPromises = runners.map((runner, index) => {
      const db = drizzle(clients[index]!, { schema }) as TestDb;
      const promise = runner(db);
      promise.catch(() => undefined);
      return promise;
    });

    // Gate the first lock in the production submit chain (full-rebuild global lock for
    // real submits; probe keys for helper isolation). Both runners can wait here before
    // any one holds the exclusive first lock and proceeds to the competition lock.
    await waitForCondition(
      async () => {
        const { waiting } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
        return waiting.length >= runners.length;
      },
      "all submit backends waiting on gated advisory lock",
      observationTimeoutMs,
    );

    await unlockGateAfterObservation(gate, lockKey, gatePhase, injectUnlock);

    await waitForCondition(
      async () => {
        const { waiting, holding } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
        return holding.length >= 1 && waiting.length >= 1;
      },
      "one submit backend holding and another waiting on gated advisory lock",
      observationTimeoutMs,
    );

    result = await Promise.all(submitPromises);
  } catch (error) {
    caughtPrimary = true;
    primaryError = error;
  } finally {
    try {
      await releaseGateLockOrClose(gate, lockKey, gatePhase, cleanupAccumulator);
    } catch (error) {
      cleanupAccumulator.record(error);
    }

    try {
      await waitForRunnersBounded(
        submitPromises,
        "runners during cleanup",
        runnerSettleMs,
        injectCleanupFailure === "runner_settle_timeout",
      );
    } catch (error) {
      cleanupAccumulator.record(error);
    }

    try {
      await closeGateWithInjectedAttemptThenFinalClose(
        gate,
        gatePhase,
        options.injectGateCloseFailure === true,
        closeInjectState,
        cleanupAccumulator,
        cleanupTrace,
      );
    } catch (error) {
      cleanupAccumulator.record(error);
    }

    if (injectCleanupFailure === "cleanup_throw_undefined") {
      cleanupAccumulator.record(undefined);
    }

    try {
      await endPostgresConnection(
        monitor,
        injectCleanupFailure === "monitor_close_throw" ? "monitor_close_throw" : undefined,
      );
    } catch (error) {
      cleanupAccumulator.record(error);
    }

    for (const [index, client] of clients.entries()) {
      try {
        await endPostgresConnection(
          client,
          injectCleanupFailure === "runner_client_close_throw" && index === 0
            ? "runner_client_close_throw"
            : undefined,
        );
      } catch (error) {
        cleanupAccumulator.record(error);
      }
    }

    options.onCleanupTrace?.(cleanupTrace);
  }

  if (caughtPrimary) {
    if (cleanupAccumulator.hasError) {
      throw combinePrimaryAndCleanupErrors(primaryError, cleanupAccumulator.toError());
    }
    throw primaryError;
  }
  if (cleanupAccumulator.hasError) {
    throw cleanupAccumulator.toError();
  }
  if (result === undefined) {
    throw new Error("Concurrent submit race finished without result");
  }
  return result;
}
