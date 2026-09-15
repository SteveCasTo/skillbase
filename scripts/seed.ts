import { createDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";

const email = process.env.DEV_INITIAL_ADMIN_EMAIL?.trim();

if (!email) {
  console.info("Development seed skipped: DEV_INITIAL_ADMIN_EMAIL is not set.");
} else {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const database = createDatabase(connectionString);
  try {
    const repository = new DrizzleAuthUserRepository(database.db);
    await repository.preprovision({
      email,
      name: "Administrador local",
      roles: ["ADMIN"],
    });
    console.info("Development administrator invitation preprovisioned.");
  } finally {
    await database.close();
  }
}

export {};
