import { AUTH_ROLES, type AuthRole } from "@/domain/auth/types";
import { createDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

function parseRoles(value: string | undefined): AuthRole[] {
  const requested = (value ?? "").split(",").map((role) => role.trim());
  const roles = requested.filter((role): role is AuthRole =>
    AUTH_ROLES.includes(role as AuthRole),
  );
  if (roles.length === 0 || roles.length !== requested.filter(Boolean).length)
    throw new Error("PREPROVISION_ROLES must contain ADMIN and/or INSTRUCTOR");
  return roles;
}

const email = process.env.PREPROVISION_EMAIL?.trim();
const name = process.env.PREPROVISION_NAME?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!email || !name || !databaseUrl)
  throw new Error(
    "DATABASE_URL, PREPROVISION_EMAIL and PREPROVISION_NAME are required",
  );

const database = createDatabase(databaseUrl);
try {
  const user = await new DrizzleAuthUserRepository(database.db).preprovision({
    email,
    name,
    roles: parseRoles(process.env.PREPROVISION_ROLES),
  });
  console.info(`Preprovisioned internal invitation ${user.id}.`);
} finally {
  await database.close();
}
