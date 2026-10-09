import { and, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AttendanceTransaction } from "./attendance-calendar";
import { lockInstructorSchedules } from "./instructor-schedule";
import {
  certificateId,
  CertificateError,
  requireCurrentClosure,
} from "@/domain/certificates/rules";

export async function certificateActor(
  tx: AttendanceTransaction,
  actorId: string,
  adminOnly = true,
) {
  certificateId(actorId);
  await lockInstructorSchedules(tx);
  const [actor] = await tx
    .select()
    .from(s.users)
    .where(eq(s.users.id, actorId))
    .for("share");
  const roles = await tx
    .select()
    .from(s.userRoles)
    .where(eq(s.userRoles.userId, actorId))
    .for("share");
  const admin = roles.some((r) => r.roleCode === "ADMIN");
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    (!admin && (adminOnly || !roles.some((r) => r.roleCode === "INSTRUCTOR")))
  )
    throw new CertificateError(
      "FORBIDDEN",
      "La cuenta no tiene autorización vigente.",
    );
  return { actor, admin };
}
export async function certificateGroup(
  tx: AttendanceTransaction,
  courseId: string,
  groupId: string,
) {
  certificateId(courseId);
  certificateId(groupId);
  const [course] = await tx
    .select()
    .from(s.courses)
    .where(eq(s.courses.id, courseId))
    .for("update");
  const [group] = await tx
    .select()
    .from(s.groups)
    .where(and(eq(s.groups.id, groupId), eq(s.groups.courseId, courseId)))
    .for("update");
  if (!course || !group)
    throw new CertificateError("NOT_FOUND", "Grupo no disponible.");
  const [state] = await tx
    .select()
    .from(s.academicGroupStates)
    .where(eq(s.academicGroupStates.groupId, groupId))
    .for("update");
  return { course, group, state };
}
export async function currentCertificate(
  tx: AttendanceTransaction,
  row: typeof s.certificates.$inferSelect,
) {
  const ctx = await certificateGroup(tx, row.courseId, row.groupId);
  requireCurrentClosure(
    ctx.state?.closed ?? false,
    ctx.state?.lastVersion ?? 0,
    row.version,
  );
  const [version] = await tx
    .select()
    .from(s.academicClosureVersions)
    .where(
      and(
        eq(s.academicClosureVersions.id, row.versionId),
        eq(s.academicClosureVersions.groupId, row.groupId),
        eq(s.academicClosureVersions.courseId, row.courseId),
        eq(s.academicClosureVersions.version, row.version),
      ),
    );
  if (!version)
    throw new CertificateError(
      "STALE_CLOSURE",
      "Versión oficial no disponible.",
    );
  return ctx;
}
