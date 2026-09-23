import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import { getDatabaseEnvironment } from "@/server/environment";

interface DatabaseConnectionOptions {
  readonly max?: number;
  readonly idleTimeout?: number;
  readonly connectTimeout?: number;
}

export const RUNTIME_DATABASE_OPTIONS = {
  max: 1,
  idleTimeout: 20,
  connectTimeout: 10,
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
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

let runtimeDatabase: ReturnType<typeof createDatabase> | undefined;

export function getDatabase() {
  runtimeDatabase ??= createDatabase(getDatabaseEnvironment().databaseUrl, {
    ...RUNTIME_DATABASE_OPTIONS,
  });
  return runtimeDatabase.db;
}
