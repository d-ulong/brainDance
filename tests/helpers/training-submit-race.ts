import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import type { TestDb } from "./db";

export function buildSubmitCompetitionLockKey(
  studentId: string,
  trainingKey: string,
  familyDate: string,
): string {
  return `${studentId}:${trainingKey}:${familyDate}`;
}

async function readBackendPid(client: postgres.Sql): Promise<number> {
  const rows = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return rows[0]!.pid;
}

type AdvisoryLockState = { waiting: number[]; holding: number[] };

async function readSubmitAdvisoryLockState(
  monitor: postgres.Sql,
  pids: number[],
  lockKey: string,
): Promise<AdvisoryLockState> {
  const rows = await monitor<{ pid: number; granted: boolean }[]>`
    SELECT l.pid, l.granted
    FROM pg_locks l
    WHERE l.locktype = 'advisory'
      AND l.objid = hashtext(${lockKey})
      AND l.classid = CASE WHEN hashtext(${lockKey}) >= 0 THEN 0 ELSE -1 END
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
  timeoutMs = 15000,
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

export async function runConcurrentSubmitsWithContentionEvidence<T>(
  lockKey: string,
  runners: Array<(db: TestDb) => Promise<T>>,
): Promise<T[]> {
  if (runners.length < 2) {
    throw new Error("At least two concurrent submit runners are required");
  }

  const gate = postgres(requireDatabaseUrl(), { max: 1 });
  const monitor = postgres(requireDatabaseUrl(), { max: 1 });
  const clients = runners.map(() => postgres(requireDatabaseUrl(), { max: 1 }));
  let submitPromises: Array<Promise<T>> = [];

  try {
    await gate`SELECT pg_advisory_lock(hashtext(${lockKey}))`;

    const pids: number[] = [];
    for (const client of clients) {
      pids.push(await readBackendPid(client));
    }

    submitPromises = runners.map((runner, index) => {
      const db = drizzle(clients[index]!, { schema }) as TestDb;
      return runner(db);
    });

    await waitForCondition(async () => {
      const { waiting } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
      return waiting.length >= runners.length;
    }, "all submit backends waiting on competition advisory lock");

    await gate`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;

    await waitForCondition(async () => {
      const { waiting, holding } = await readSubmitAdvisoryLockState(monitor, pids, lockKey);
      return holding.length >= 1 && waiting.length >= 1;
    }, "one submit backend holding and another waiting on competition advisory lock");

    return await Promise.all(submitPromises);
  } finally {
    await Promise.allSettled(submitPromises);
    await gate.end({ timeout: 5 }).catch(() => undefined);
    await monitor.end({ timeout: 5 }).catch(() => undefined);
    await Promise.all(clients.map((client) => client.end({ timeout: 5 }).catch(() => undefined)));
  }
}
