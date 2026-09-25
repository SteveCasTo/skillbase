import { createClient } from "@supabase/supabase-js";
import { inArray } from "drizzle-orm";

import { createDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AUTH_FIXTURES } from "../tests/fixtures/auth-users";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";

const local = getLocalSupabaseEnvironment();
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error("DATABASE_URL is required in .env.");
const actual = new URL(configured);
const expected = new URL(local.databaseUrl);
if (
  actual.hostname !== expected.hostname ||
  actual.port !== expected.port ||
  actual.pathname !== expected.pathname ||
  actual.username !== expected.username
)
  throw new Error(
    "This cleanup accepts only the running local Supabase database.",
  );

const fixtures = Object.values(AUTH_FIXTURES);
const names = new Map<string, string>(
  fixtures.map(({ email, name }) => [email, name]),
);
const emails = [...names.keys()];
const database = createDatabase(configured);
try {
  const profiles = await database.db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.email, emails));
  if (profiles.some(({ email, name }) => names.get(email) !== name))
    throw new Error(
      "A fixture email belongs to a different profile; cleanup stopped.",
    );

  // Do not delete audit events, courses, formats, or any account not matching
  // the exact synthetic fixture identities. FK restrictions fail closed.
  const deleted = await database.db
    .delete(users)
    .where(inArray(users.email, emails))
    .returning({ id: users.id });

  const auth = createClient(local.apiUrl, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authIds: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await auth.auth.admin.listUsers({
      page,
      perPage: 50,
    });
    if (error) throw error;
    for (const identity of data.users) {
      if (identity.email && names.has(identity.email))
        authIds.push(identity.id);
    }
    if (data.users.length < 50) break;
  }
  for (const id of authIds) {
    const result = await auth.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
  }
  console.info(
    `Removed ${deleted.length} legacy test profiles and ${authIds.length} test Auth identities from local Supabase.`,
  );
} finally {
  await database.close();
}
