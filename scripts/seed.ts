import { createDatabase } from "@/server/db/client";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { courseTypes, courseTypeRevisions, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const email = process.env.DEV_INITIAL_ADMIN_EMAIL?.trim();

{
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const database = createDatabase(connectionString);
  try {
    if (email) {
      const [existing] = await database.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (existing?.status !== "ACTIVE") {
        const repository = new DrizzleAuthUserRepository(database.db);
        await repository.preprovision({
          email,
          name: "Administrador local",
          roles: ["ADMIN"],
        });
      }
    }
    // Development-only examples; production terms are never inferred from these.
    for (const format of [
      {
        name: "Formato 20 horas",
        totalHours: 20,
        studentAmount: "80.00",
        externalAmount: "100.00",
      },
      {
        name: "Formato 30 horas",
        totalHours: 30,
        studentAmount: "120.00",
        externalAmount: "150.00",
      },
    ]) {
      await database.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(courseTypes)
          .where(eq(courseTypes.name, format.name))
          .limit(1);
        if (existing) return;
        const [type] = await tx
          .insert(courseTypes)
          .values({ name: format.name })
          .returning();
        if (!type) throw new Error("Development format insert failed");
        await tx.insert(courseTypeRevisions).values({
          courseTypeId: type.id,
          revisionNumber: 1,
          totalHours: format.totalHours,
          studentAmount: format.studentAmount,
          externalAmount: format.externalAmount,
        });
      });
    }
    console.info(
      "Development formats seeded; administrator invitation",
      email ? "checked." : "skipped.",
    );
  } finally {
    await database.close();
  }
}

export {};
