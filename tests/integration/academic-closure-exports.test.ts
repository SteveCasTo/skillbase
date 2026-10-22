import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import type { InternalUser } from "@/domain/auth/types";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
import { createRegistrationRepository } from "@/server/db/repositories/registration-repository";
import {
  handleClosureDownload,
  type ClosureDownload,
} from "@/server/academic-closure/exports/http";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createClosureFixture } from "../fixtures/academic-closure";
import { evaluationFixtureTables } from "../fixtures/evaluation-cleanup";

const connection = createDatabase(getTestSupabaseEnvironment().databaseUrl, {
  max: 4,
});
const db = connection.db;
let now = new Date("2099-02-01T12:00:00Z");
const clock = () => now;
const repo = new DrizzleClosureRepository(db, clock);
let originalAttendanceSettings: typeof s.attendanceSettings.$inferSelect;
beforeAll(async () => {
  const [settings] = await db.select().from(s.attendanceSettings);
  if (!settings) throw new Error("Missing attendance settings singleton");
  originalAttendanceSettings = settings;
});
afterAll(async () => {
  try {
    await db
      .update(s.attendanceSettings)
      .set(originalAttendanceSettings)
      .where(eq(s.attendanceSettings.id, originalAttendanceSettings.id));
  } finally {
    try {
      await db.execute(
        sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
      );
    } finally {
      await connection.close();
    }
  }
});
test("academic exports use authorized closed snapshots and retain historical files after reopen/settings/name changes", async () => {
  const f = await createClosureFixture(db, clock);
  await createRegistrationRepository(db, clock).recordPayment(
    {
      requestKey: crypto.randomUUID(),
      registrationId: f.unpaid.id,
      revision: f.unpaid.revision,
      cash: {
        amountCents: 6000,
        effectiveDate: null,
        paymentMethod: "QR",
        reason: "Synthetic balance payment",
      },
    },
    f.admin.id,
  );
  const courseId = f.course.id,
    groupId = f.groups[0]!.id;
  const evaluation = new DrizzleEvaluationRepository(db, clock);
  await evaluation.saveScheme(f.admin.id, {
    courseId,
    requestKey: crypto.randomUUID(),
    schemeRevision: 0,
    components: f.components,
  });
  const command = {
    courseId,
    groupId,
    requestKey: crypto.randomUUID(),
    revision: 0,
  };
  const cancelled = f.calendar.sessions.at(-1)!;
  await f.attendance.cancel(f.admin.id, {
    ...command,
    sessionId: cancelled.id,
    revision: cancelled.revision,
    reason: "Synthetic cancellation",
  });
  now = new Date("2099-03-06T12:00:00Z");
  let schemeRevision = 1;
  for (const registrationId of [f.paid.id, f.unpaid.id]) {
    const saved = await evaluation.saveRow(f.instructor.id, {
      courseId,
      groupId,
      registrationId,
      requestKey: crypto.randomUUID(),
      schemeRevision,
      grades: [
        { componentId: f.components[0]!.id, gradeRevision: 0, score: "70" },
      ],
    });
    schemeRevision = saved.schemeRevision;
  }
  const actor = (
    user: typeof f.admin,
    roles: InternalUser["roles"],
  ): InternalUser => ({ ...user, roles });
  const admin = actor(f.admin, ["ADMIN"]),
    instructor = actor(f.instructor, ["INSTRUCTOR"]),
    foreign = actor(f.foreign, ["INSTRUCTOR"]);
  const download = (
    user: InternalUser,
    artifact: ClosureDownload,
    version = "1",
  ) =>
    handleClosureDownload(
      {
        locals: { internalUser: user },
        params: { id: courseId, groupId, version },
      },
      artifact,
      user.roles.includes("ADMIN") ? "ADMIN" : "INSTRUCTOR",
      repo,
    );
  expect((await download(admin, "planilla.csv")).status).toBe(404);
  await repo.close(f.instructor.id, command);
  const full = await repo.getVersion(f.admin.id, courseId, groupId, 1);
  if (full.report.access !== "ADMIN")
    throw new Error("Expected admin projection");
  const paid = full.report.participants.find(
    (person) => person.registrationId === f.paid.id,
  )!;
  const ci = paid.ci;
  expect(full.report.participants).toHaveLength(2);
  expect(paid).toMatchObject({
    registrationId: f.paid.id,
    participantCategory: "STUDENT",
    receivedPayments: {
      cashCents: "8000",
      qrCents: "0",
      unregisteredCents: "0",
      totalCents: "8000",
    },
  });
  expect(
    full.report.participants.find(
      (person) => person.registrationId === f.unpaid.id,
    )!.receivedPayments,
  ).toEqual({
    cashCents: "2000",
    qrCents: "6000",
    unregisteredCents: "0",
    totalCents: "8000",
  });
  const original = new Uint8Array(
    await (await download(admin, "planilla.csv")).arrayBuffer(),
  );
  expect(new TextDecoder().decode(original)).toContain(ci);
  expect(new TextDecoder().decode(original)).toContain(
    '"Estudiante";"20.00";"60.00";"0.00";"80.00"',
  );
  expect(new TextDecoder().decode(original)).not.toContain("UUID responsable");
  const privateCsv = await (await download(instructor, "planilla.csv")).text();
  expect(privateCsv).not.toContain(ci);
  expect(privateCsv).not.toContain('"CI"');
  expect(privateCsv).not.toContain("closure@test.invalid");
  for (const sensitive of [
    "Categoría",
    "Efectivo",
    "QR",
    "percibido",
    '"20.00";"60.00"',
  ])
    expect(privateCsv).not.toContain(sensitive);
  const projected = await repo.getVersion(
    f.instructor.id,
    courseId,
    groupId,
    1,
  );
  expect(projected.report.participants[0]).not.toHaveProperty(
    "participantCategory",
  );
  expect(projected.report.participants[0]).not.toHaveProperty(
    "receivedPayments",
  );
  let originalPdf: Uint8Array<ArrayBuffer> | undefined;
  for (const user of [admin, instructor]) {
    let aliasPdf: Uint8Array<ArrayBuffer> | undefined;
    for (const artifact of ["planilla.pdf", "informe.pdf"] as const) {
      const response = await download(user, artifact);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="cierre-v1-informe.pdf"',
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (aliasPdf) expect(bytes).toEqual(aliasPdf);
      else aliasPdf = bytes;
      if (user === admin && artifact === "informe.pdf") originalPdf = bytes;
      const pdf = await PDFDocument.load(bytes, {
        updateMetadata: false,
      });
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(pdf.getAuthor()).toBe(f.instructor.name);
      expect(pdf.getTitle()).toBe("Informe de cierre académico");
      expect(pdf.getCreationDate()).toEqual(now);
    }
  }
  expect((await download(foreign, "planilla.csv")).status).toBe(404);
  expect((await download(admin, "planilla.csv", "2")).status).toBe(404);
  await repo.reopen(f.admin.id, {
    ...command,
    revision: 1,
    requestKey: crypto.randomUUID(),
    reason: "Synthetic correction",
  });
  await db
    .update(s.users)
    .set({ name: "Changed current name" })
    .where(eq(s.users.id, f.instructor.id));
  await db
    .update(s.courses)
    .set({ minimumGrade: 90, name: "Changed current course" })
    .where(eq(s.courses.id, courseId));
  const settings = await f.attendance.getSettings(f.admin.id);
  await f.attendance.updateSettings(f.admin.id, {
    requestKey: crypto.randomUUID(),
    revision: settings.revision,
    consecutiveAbsenceLimit: 10,
  });
  const historical = new Uint8Array(
    await (await download(admin, "planilla.csv")).arrayBuffer(),
  );
  expect(historical).toEqual(original);
  if (!originalPdf) throw new Error("Missing original PDF evidence");
  expect(
    new Uint8Array(await (await download(admin, "informe.pdf")).arrayBuffer()),
  ).toEqual(originalPdf);
  await db
    .update(s.users)
    .set({ status: "DISABLED" })
    .where(eq(s.users.id, f.instructor.id));
  expect((await download(instructor, "planilla.csv")).status).toBe(403);
});
