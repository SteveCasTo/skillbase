import { AsyncLocalStorage } from "node:async_hooks";
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

interface RequestDatabaseScope {
  connection?: ReturnType<typeof createDatabase>;
  deadline?: ReturnType<typeof setTimeout>;
  readonly readDeadlineMs?: number;
  readonly databaseUrl?: string;
}

const requestDatabase = new AsyncLocalStorage<RequestDatabaseScope>();

/** Do not reuse a serverless invocation's TCP socket on a later request. */
export async function withRequestDatabase<T>(
  work: () => Promise<T>,
  readDeadlineMs?: number,
  databaseUrl?: string,
): Promise<T> {
  const scope: RequestDatabaseScope = {
    ...(readDeadlineMs === undefined ? {} : { readDeadlineMs }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
  return requestDatabase.run(scope, async () => {
    try {
      return await work();
    } finally {
      if (scope.deadline) clearTimeout(scope.deadline);
      if (scope.connection) await scope.connection.discard();
    }
  });
}

export function getDatabase() {
  const scope = requestDatabase.getStore();
  if (!scope) throw new Error("Database access requires a request scope");
  if (!scope.connection) {
    scope.connection = createDatabase(
      scope.databaseUrl ?? getDatabaseEnvironment().databaseUrl,
      RUNTIME_DATABASE_OPTIONS,
    );
    if (scope.readDeadlineMs)
      scope.deadline = setTimeout(() => {
        console.warn(
          "[database] read deadline exceeded; closing request connection",
        );
        void scope.connection?.discard().catch(() => {});
      }, scope.readDeadlineMs);
  }
  return scope.connection.db;
}
