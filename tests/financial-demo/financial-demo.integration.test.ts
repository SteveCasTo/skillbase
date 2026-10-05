import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { runFinancialDemo } from "../../scripts/financial-demo";
import {
  financialDemoId,
  financialDemoPlan,
} from "../../scripts/financial-demo-plan";
import { SEED_OWNER, teachers } from "../../scripts/renew-demo-plan";
import { DrizzleRegistrationRepository } from "@/server/db/repositories/registration-repository";

test("isolated demo is read-only by default, atomic, provenance-bound and never doubles cash", async () => {
  const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
    max: 1,
  });
  try {
    const db = connection.db;
    const [admin] = await db
      .insert(schema.users)
      .values({
        email: "financial.operator@example.test",
        name: "Operador sintético",
        status: "ACTIVE",
        authUserId: crypto.randomUUID(),
      })
      .returning();
    await db
      .insert(schema.userRoles)
      .values({ userId: admin!.id, roleCode: "ADMIN" });
    const owned = new Set<string>();
    for (const teacher of teachers) {
      const authUserId = crypto.randomUUID();
      owned.add(authUserId);
      const [user] = await db
        .insert(schema.users)
        .values({
          email: teacher.email,
          name: `${teacher.firstName} ${teacher.lastName}`,
          status: "ACTIVE",
          authUserId,
          authPrimaryProvider: "EMAIL",
        })
        .returning();
      await db
        .insert(schema.userRoles)
        .values({ userId: user!.id, roleCode: "INSTRUCTOR" });
      await db.insert(schema.instructorProfiles).values({
        id: user!.id,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
      });
    }
    const identities = {
      async verify(id: string, owner?: string) {
        return owner === SEED_OWNER ? owned.has(id) : id === admin!.authUserId;
      },
    };
    const options = {
      actorId: admin!.id,
      identities,
      anchorDay: "2026-10-04",
      apply: false,
    };
    const counts = async () =>
      (
        await db.execute(
          sql`select (select count(*)::int from courses) as courses,(select count(*)::int from pre_registrations) as registrations,(select count(*)::int from registration_ledger) as ledger,(select count(*)::int from registration_command_receipts) as receipts,(select count(*)::int from audit_events) as audit`,
        )
      )[0];
    const before = await counts();
    const settingsBefore = await db.select().from(schema.registrationSettings);
    await runFinancialDemo(db, options);
    expect(await counts()).toEqual(before);
    await expect(
      runFinancialDemo(db, {
        ...options,
        apply: true,
        identities: {
          async verify() {
            return false;
          },
        },
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
    await expect(
      runFinancialDemo(db, {
        ...options,
        apply: true,
        identities: {
          async verify(id, owner) {
            return !owner && id === admin!.authUserId;
          },
        },
      }),
    ).rejects.toThrow("seed-owned");
    expect(await counts()).toEqual(before);
    // A CI collision late in the graph must be detected before any app writes.
    const ci = financialDemoPlan(options.anchorDay, 25).samples[2]!
      .registrations[4]!.participant.ci;
    const [collision] = await db
      .insert(schema.participants)
      .values({
        ci,
        firstName: "Persona",
        lastName: "Ajena",
        email: "collision@example.test",
      })
      .returning();
    await expect(
      runFinancialDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("collision");
    expect(await counts()).toEqual(before);
    // Test-only rollback of the unreferenced collision, not runner cleanup or financial deletion.
    await db
      .delete(schema.participants)
      .where(eq(schema.participants.id, collision!.id));
    // Deliberately invalidate the final fixture AFTER preflight: earlier valid
    // use cases execute, but their savepoints must not escape the outer rollback.
    await expect(
      runFinancialDemo(db, {
        ...options,
        apply: true,
        preview(plan) {
          plan.samples[3]!.registrations[0]!.participant.email = "invalid";
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await counts()).toEqual(before);
    const context = await runFinancialDemo(db, { ...options, apply: true });
    expect(Object.keys(context.registrations)).toHaveLength(11);
    const after = await counts();
    expect(after).toMatchObject({
      courses: 4,
      registrations: 11,
      ledger: 12,
      receipts: 16,
    });
    const receipts = await db.select().from(schema.registrationCommandReceipts);
    expect(
      receipts.every(
        (r) => r.actorId === admin!.id && /^[a-f0-9]{64}$/u.test(r.fingerprint),
      ),
    ).toBe(true);
    const repo = new DrizzleRegistrationRepository(
      db,
      () => new Date("2026-10-04T16:00:00Z"),
    );
    const detail = async (key: string) =>
      (await repo.detail(context.registrations[key]!, admin!.id))!;
    expect((await detail("past:partial")).registration).toMatchObject({
      membershipStatus: "SALDOVENCIDO",
      paidCents: 2000,
      balanceCents: 6000,
    });
    expect((await detail("past:paid")).registration).toMatchObject({
      membershipStatus: "INSCRITO",
      paidCents: 8000,
      balanceCents: 0,
    });
    expect((await detail("future:partial")).registration).toMatchObject({
      membershipStatus: "PREINSCRITO",
      financialStatus: "PARTIAL",
    });
    expect((await detail("future:owed")).registration).toMatchObject({
      state: "CANCELLED",
      refundDueCents: 8000,
      refundedCents: 0,
    });
    expect((await detail("future:refunded")).registration).toMatchObject({
      state: "CANCELLED",
      refundDueCents: 0,
      refundedCents: 8000,
      financialStatus: "REFUNDED",
    });
    expect((await detail("future:transfer")).registration).toMatchObject({
      groupId: context.courses.future!.groupIds[1],
      paidCents: 8000,
      price: { totalPriceCents: 8000 },
    });
    expect((await detail("future:completed")).ledger).toHaveLength(2);
    expect((await detail("free:free")).ledger).toHaveLength(0);
    expect((await detail("free:free")).registration).toMatchObject({
      financialStatus: "EXEMPT",
      price: { totalPriceCents: 0 },
      paidCents: 0,
    });
    expect(
      await runFinancialDemo(db, {
        ...options,
        apply: true,
        now: new Date("2027-02-01T00:00:00Z"),
      }),
    ).toEqual(context);
    expect(await counts()).toEqual(after);
    expect(await db.select().from(schema.registrationSettings)).toEqual(
      settingsBefore,
    );
    await expect(
      runFinancialDemo(db, {
        ...options,
        apply: true,
        anchorDay: "2026-10-05",
      }),
    ).rejects.toThrow("anchor");
    await db
      .update(schema.courses)
      .set({ name: "Edición manual" })
      .where(eq(schema.courses.id, context.courses.future!.courseId));
    await expect(
      runFinancialDemo(db, { ...options, apply: true }),
    ).rejects.toThrow("provenance");
    expect(await counts()).toEqual(after);
    expect(
      (
        await db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.id, financialDemoId("manifest")))
      )[0]!.action,
    ).toBe("DEMO_SEEDED");
  } finally {
    await connection.close();
  }
}, 120000);
