import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import { buildSubmitCompetitionLockKey } from "@/modules/training/submit-competition-lock-key";
import type { TestDb } from "./db";

export { buildSubmitCompetitionLockKey };

const DEFAULT_OBSERVATION_TIMEOUT_MS = 15000;
const DEFAULT_RUNNER_SETTLE_MS = 5000;

export const FIXED_POSITIVE_HASH_LOCK_KEY = "m5-lock-probe-1";
export const FIXED_NEGATIVE_HASH_LOCK_KEY = "m5-lock-probe-0";

async function readBackendPid(client: postgres.Sql): Promise<number> {
  const rows = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return rows[0]!.pid;
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

export type GateUnlockInjection = "throw" | "return_false";

async function queryAdvisoryUnlock(gate: postgres.Sql, lockKey: string): Promise<boolean> {
  const rows = await gate<{ pg_advisory_unlock: boolean }[]>`
    SELECT pg_advisory_unlock(hashtext(${lockKey})) AS pg_advisory_unlock
  `;
  return rows[0]?.pg_advisory_unlock ?? false;
}

async function closeGateConnection(
  gate: postgres.Sql,
  gatePhase: { value: GateLockPhase },
): Promise<void> {
  if (gatePhase.value === "closed") {
    return;
  }
  await gate.end({ timeout: 5 }).catch(() => undefined);
  gatePhase.value = "closed";
}

async function releaseGateLockOrClose(
  gate: postgres.Sql,
  lockKey: string,
  gatePhase: { value: GateLockPhase },
  injectUnlock?: GateUnlockInjection,
): Promise<void> {
  if (gatePhase.value !== "holding") {
    return;
  }

  try {
    let unlocked: boolean;
    if (injectUnlock === "throw") {
      throw new Error("injected gate unlock failure");
    }
    if (injectUnlock === "return_false") {
      unlocked = false;
    } else {
      unlocked = await queryAdvisoryUnlock(gate, lockKey);
    }

    if (unlocked) {
      gatePhase.value = "released";
      return;
    }
  } catch {
    // fall through to terminate gate connection below
  }

  await closeGateConnection(gate, gatePhase);
}

async function waitForRunnersBounded<T>(
  submitPromises: Array<Promise<T>>,
  label: string,
  timeoutMs: number,
): Promise<void> {
  if (submitPromises.length === 0) {
    return;
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

export type ConcurrentSubmitRaceOptions = {
  observationTimeoutMs?: number;
  runnerSettleMs?: number;
  /** Test-only: force gate unlock failure during cleanup. */
  injectGateUnlockFailure?: GateUnlockInjection;
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

  const gate = postgres(requireDatabaseUrl(), { max: 1 });
  const monitor = postgres(requireDatabaseUrl(), { max: 1 });
  const clients = runners.map(() => postgres(requireDatabaseUrl(), { max: 1 }));
  let submitPromises: Array<Promise<T>> = [];
  const gatePhase: { value: GateLockPhase } = { value: "unheld" };

  let result: T[] | undefined;
  let primaryError: unknown;

  try {
    await gate`SELECT pg_advisory_lock(hashtext(${lockKey}))`;
    gatePhase.value = "holding";

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

    await waitForCondition(
      async () => {
        const { waiting } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
        return waiting.length >= runners.length;
      },
      "all submit backends waiting on competition advisory lock",
      observationTimeoutMs,
    );

    const unlocked = await queryAdvisoryUnlock(gate, lockKey);
    if (!unlocked) {
      await closeGateConnection(gate, gatePhase);
      throw new Error(`Failed to release competition advisory lock for ${lockKey}`);
    }
    gatePhase.value = "released";

    await waitForCondition(
      async () => {
        const { waiting, holding } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
        return holding.length >= 1 && waiting.length >= 1;
      },
      "one submit backend holding and another waiting on competition advisory lock",
      observationTimeoutMs,
    );

    result = await Promise.all(submitPromises);
  } catch (error) {
    primaryError = error;
  } finally {
    await releaseGateLockOrClose(gate, lockKey, gatePhase, injectUnlock);
    await waitForRunnersBounded(submitPromises, "runners during cleanup", runnerSettleMs).catch(
      () => undefined,
    );
    if (gatePhase.value !== "closed") {
      await closeGateConnection(gate, gatePhase);
    }
    await monitor.end({ timeout: 5 }).catch(() => undefined);
    await Promise.all(clients.map((client) => client.end({ timeout: 5 }).catch(() => undefined)));
  }

  if (primaryError) {
    throw primaryError;
  }
  return result!;
}
