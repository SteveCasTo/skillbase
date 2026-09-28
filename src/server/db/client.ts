import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import { getDatabaseEnvironment } from "@/server/environment";

interface DatabaseConnectionOptions {
  readonly max?: number;
  readonly idleTimeout?: number;
  readonly connectTimeout?: number;
  readonly maxPipeline?: number;
}

export const RUNTIME_DATABASE_OPTIONS = {
  max: 1,
  idleTimeout: 20,
  connectTimeout: 10,
  maxPipeline: 1,
} as const satisfies DatabaseConnectionOptions;

export function createDatabase(
  connectionString: string,
  options: DatabaseConnectionOptions = {},
) {
  const client = postgres(connectionString, {
    prepare: false,
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.idleTimeout === undefined
      ? {}
      : { idle_timeout: options.idleTimeout }),
    ...(options.connectTimeout === undefined
      ? {}
      : { connect_timeout: options.connectTimeout }),
    ...(options.maxPipeline === undefined
      ? {}
      : { max_pipeline: options.maxPipeline }),
  });

  return {
    db: drizzle(client, { schema }),
    probe: async () => {
      await client`select 1`;
    },
    close: () => client.end(),
    discard: () => client.end({ timeout: 1 }),
  };
}

let runtimeDatabase: ReturnType<typeof createDatabase> | undefined;
let lastProbe = 0;
let pendingProbe: Promise<void> | undefined;

interface ProbeConnection {
  probe(): Promise<void>;
  discard(): Promise<void>;
}

async function probeWithDeadline(
  connection: ProbeConnection,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connection.probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database probe timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recoverDatabaseConnection<T extends ProbeConnection>(
  connection: T,
  create: () => T,
  timeoutMs = 5_000,
): Promise<T> {
  try {
    await probeWithDeadline(connection, timeoutMs);
    return connection;
  } catch {
    const replacement = create();
    void connection.discard().catch(() => {});
    try {
      await probeWithDeadline(replacement, timeoutMs);
    } catch (error) {
      void replacement.discard().catch(() => {});
      throw error;
    }
    console.warn("[database] stale connection recycled");
    return replacement;
  }
}

/** Check a socket after serverless suspension before handing it to a request. */
export async function ensureRuntimeDatabaseHealthy(): Promise<void> {
  if (pendingProbe) return pendingProbe;
  if (runtimeDatabase && Date.now() - lastProbe < 5_000) return;

  pendingProbe = (async () => {
    const connection =
      runtimeDatabase ??
      createDatabase(
        getDatabaseEnvironment().databaseUrl,
        RUNTIME_DATABASE_OPTIONS,
      );
    runtimeDatabase = connection;
    try {
      // A frozen function may reuse a dead socket. Verify and replace it before
      // any request queues a real query behind the stale connection.
      runtimeDatabase = await recoverDatabaseConnection(connection, () =>
        createDatabase(
          getDatabaseEnvironment().databaseUrl,
          RUNTIME_DATABASE_OPTIONS,
        ),
      );
      lastProbe = Date.now();
    } catch (error) {
      runtimeDatabase = undefined;
      throw error;
    }
  })().finally(() => {
    pendingProbe = undefined;
  });
  return pendingProbe;
}

export function getDatabase() {
  runtimeDatabase ??= createDatabase(getDatabaseEnvironment().databaseUrl, {
    ...RUNTIME_DATABASE_OPTIONS,
  });
  return runtimeDatabase.db;
}
