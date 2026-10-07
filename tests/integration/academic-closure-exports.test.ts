import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import type { InternalUser } from "@/domain/auth/types";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
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
afterAll(async () => {
  await db.execute(
    sql`truncate ${evaluationFixtureTables}, participant_attendance, instructor_attendance, session_roster, attendance_command_receipts, group_sessions, registration_ledger, registration_command_receipts, pre_registrations, participants restrict`,
  );
  await connection.close();
});
test("academic exports use authorized closed snapshots and retain historical files after reopen/settings/name changes", async () => {
  const f = await createClosureFixture(db, clock);
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
  await evaluation.saveRow(f.instructor.id, {
    courseId,
    groupId,
    registrationId: f.paid.id,
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    grades: [
      { componentId: f.components[0]!.id, gradeRevision: 0, score: "70" },
    ],
  });
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
  const ci = full.report.participants[0]!.ci;
  const original = new Uint8Array(
    await (await download(admin, "planilla.csv")).arrayBuffer(),
  );
  expect(new TextDecoder().decode(original)).toContain(ci);
  const privateCsv = await (await download(instructor, "planilla.csv")).text();
  expect(privateCsv).not.toContain(ci);
  expect(privateCsv).not.toContain('"CI"');
  expect(privateCsv).not.toContain("closure@test.invalid");
  let originalPdf: Uint8Array<ArrayBuffer> | undefined;
  for (const user of [admin, instructor])
    for (const artifact of ["planilla.pdf", "informe.pdf"] as const) {
      const response = await download(user, artifact);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (user === admin && artifact === "informe.pdf") originalPdf = bytes;
      const pdf = await PDFDocument.load(bytes, {
        updateMetadata: false,
      });
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(pdf.getAuthor()).toBe(f.instructor.name);
      expect(pdf.getCreationDate()).toEqual(now);
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
