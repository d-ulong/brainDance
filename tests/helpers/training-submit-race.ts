import { sql } from "drizzle-orm";
import postgres from "postgres";

import { requireDatabaseUrl } from "@/lib/env";
import type { TestDb } from "./db";

const RACE_WITNESS_TABLE = "test_m5_submit_race_witness";

function createGate<T>() {
  let open!: (value: T) => void;
  let release!: () => void;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, released, open, release };
}

export function createSubmitRaceBarrier(participants: number) {
  const armed = createGate<void>();
  const proceed = createGate<void>();
  let arrived = 0;

  return {
    async waitArmed(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        armed.open(undefined);
      }
      await proceed.released;
    },
    waitAllArmed(): Promise<void> {
      return armed.opened;
    },
    release(): void {
      proceed.release();
    },
  };
}

export async function ensureSubmitRaceWitnessTable(db: TestDb): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS ${RACE_WITNESS_TABLE} (
      participant int PRIMARY KEY,
      phase text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `),
  );
  await db.execute(sql.raw(`TRUNCATE ${RACE_WITNESS_TABLE}`));
}

export async function assertCompetitionAdvisoryLockContention(lockKey: string): Promise<void> {
  const clientA = postgres(requireDatabaseUrl(), { max: 1 });
  const clientB = postgres(requireDatabaseUrl(), { max: 1 });
  const monitor = postgres(requireDatabaseUrl(), { max: 1 });

  try {
    await clientA`SELECT pg_advisory_lock(hashtext(${lockKey}))`;

    const blockedPid = (await clientB<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const acquirePromise = clientB.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    });

    let contentionObserved = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await monitor<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND granted = false
            AND pid = ${blockedPid}
        ) AS waiting
      `;
      if (rows[0]?.waiting) {
        contentionObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    await clientA`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;
    await acquirePromise;
    if (!contentionObserved) {
      throw new Error("Expected advisory lock contention on competition key");
    }
  } finally {
    await clientA.end({ timeout: 5 });
    await clientB.end({ timeout: 5 });
    await monitor.end({ timeout: 5 });
  }
}

export async function signalSubmitRaceArrival(
  db: TestDb,
  participant: number,
  barrier: ReturnType<typeof createSubmitRaceBarrier>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO test_m5_submit_race_witness (participant, phase)
    VALUES (${participant}, 'ready_to_submit')
    ON CONFLICT (participant)
    DO UPDATE SET phase = 'ready_to_submit', updated_at = now()
  `);
  await barrier.waitArmed();
}
