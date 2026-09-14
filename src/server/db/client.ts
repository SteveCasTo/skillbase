import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}
