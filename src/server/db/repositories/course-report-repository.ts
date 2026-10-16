import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  COURSE_REPORT_LIMIT,
  CourseReportError,
  type CourseReportRepository,
  type CourseReportSource,
} from "@/application/courses/course-report";
import {
  matchesCourseSearch,
  type CourseReportFilter,
} from "@/domain/courses/report-filters";
import {
  createPriceSnapshot,
  DEFAULT_REGISTRATION_SETTINGS,
} from "@/domain/pre-registrations/money";
import * as s from "@/server/db/schema";
import { requireFreshRegistrationActor } from "./registration-support";

/** One repeatable-read transaction: fresh ADMIN, current membership/ledger,
 * calendar and the current official closure. No per-course or per-person reads. */
export class DrizzleCourseReportRepository implements CourseReportRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof s>) {}
  async read(
    actorId: string,
    filter: CourseReportFilter,
    now: Date,
  ): Promise<CourseReportSource> {
    return this.db.transaction(
      async (tx) => {
        await requireFreshRegistrationActor(tx, actorId);
        const candidates = await tx
          .select({
            id: s.courses.id,
            name: s.courses.name,
            slug: s.courses.slug,
            level: s.courses.level,
            status: s.courses.status,
            startsAt: s.courses.startsAt,
            endsAt: s.courses.endsAt,
            weekdaysMask: s.courses.weekdaysMask,
            revisionId: s.courseTypeRevisions.id,
            studentAmount: s.courseTypeRevisions.studentAmount,
            externalAmount: s.courseTypeRevisions.externalAmount,
            firstName: s.instructorProfiles.firstName,
            lastName: s.instructorProfiles.lastName,
          })
          .from(s.courses)
          .innerJoin(
            s.courseTypeRevisions,
            eq(s.courseTypeRevisions.id, s.courses.courseTypeRevisionId),
          )
          .leftJoin(
            s.instructorProfiles,
            eq(s.instructorProfiles.id, s.courses.instructorId),
          )
          .where(
            filter.status === "ALL"
              ? undefined
              : eq(s.courses.status, filter.status),
          )
          .orderBy(asc(s.courses.name), asc(s.courses.id));
        // Use the exact Unicode equivalence of the course list, not a SQL approximation.
        const selected = candidates.filter((course) =>
          matchesCourseSearch(course, filter.search),
        );
        if (selected.length > COURSE_REPORT_LIMIT)
          throw new CourseReportError(
            "EXPORT_LIMIT_EXCEEDED",
            "El informe supera 1000 cursos. Acota los filtros.",
          );
        if (!selected.length)
          return { courses: [], groups: [], sessions: [], registrations: [] };
        const courseIds = selected.map((course) => course.id);
        const [settings] = await tx
          .select()
          .from(s.registrationSettings)
          .where(eq(s.registrationSettings.id, 1));
        const courses = selected.map((course) => {
          const price = (
            participantType: "STUDENT" | "EXTERNAL" | "AUXILIARY",
          ) =>
            createPriceSnapshot({
              participantType,
              courseTypeRevisionId: course.revisionId,
              studentAmount: course.studentAmount,
              externalAmount: course.externalAmount,
              settings: settings ?? DEFAULT_REGISTRATION_SETTINGS,
            }).totalPriceCents.toString();
          return {
            id: course.id,
            name: course.name,
            level: course.level,
            status: course.status,
            startsAt: course.startsAt,
            endsAt: course.endsAt,
            instructorName:
              course.firstName && course.lastName
                ? `${course.firstName} ${course.lastName}`
                : null,
            studentCents: price("STUDENT"),
            externalCents: price("EXTERNAL"),
            auxiliaryCents: price("AUXILIARY"),
            weekdaysMask: course.weekdaysMask,
          };
        });
        const groups = await tx
          .select({
            id: s.groups.id,
            courseId: s.groups.courseId,
            startsAt: s.groups.startsAt,
            endsAt: s.groups.endsAt,
            status: s.groups.status,
            closed: sql<boolean>`coalesce(${s.academicGroupStates.closed}, false)`,
            lastVersion: sql<number>`coalesce(${s.academicGroupStates.lastVersion}, 0)`,
            officialVersion: s.academicClosureVersions.version,
            // Project only the evidence needed for reconciliation; no names, CI or grades.
            officialParticipants: sql<unknown>`(select jsonb_agg(jsonb_build_object('registrationId', p->>'registrationId', 'participantId', p->>'participantId', 'academicallyPassed', p->'academicallyPassed')) from jsonb_array_elements(${s.academicClosureVersions.report}->'participants') p)`,
          })
          .from(s.groups)
          .leftJoin(
            s.academicGroupStates,
            eq(s.academicGroupStates.groupId, s.groups.id),
          )
          .leftJoin(
            s.academicClosureVersions,
            and(
              eq(s.academicClosureVersions.groupId, s.groups.id),
              eq(
                s.academicClosureVersions.version,
                s.academicGroupStates.lastVersion,
              ),
              eq(s.academicGroupStates.closed, true),
            ),
          )
          .where(inArray(s.groups.courseId, courseIds))
          .orderBy(asc(s.groups.startsAt), asc(s.groups.id))
          .limit(COURSE_REPORT_LIMIT + 1);
        if (groups.length > COURSE_REPORT_LIMIT)
          throw new CourseReportError(
            "EXPORT_LIMIT_EXCEEDED",
            "El informe supera 1000 grupos. Acota los filtros.",
          );
        const sessions = groups.length
          ? await tx
              .select({
                groupId: s.groupSessions.groupId,
                startsAt: s.groupSessions.startsAt,
                endsAt: s.groupSessions.endsAt,
              })
              .from(s.groupSessions)
              .where(
                and(
                  inArray(
                    s.groupSessions.groupId,
                    groups.map((group) => group.id),
                  ),
                  isNull(s.groupSessions.cancelledAt),
                ),
              )
              .orderBy(asc(s.groupSessions.startsAt))
          : [];
        const registrations = await tx
          .select({
            id: s.preRegistrations.id,
            participantId: s.preRegistrations.participantId,
            courseId: s.preRegistrations.courseId,
            groupId: s.preRegistrations.groupId,
            state: s.preRegistrations.state,
            totalCents: s.preRegistrations.totalPriceCents,
            paidCents: sql<string>`coalesce(sum(case when ${s.registrationLedger.kind} = 'PAYMENT' then ${s.registrationLedger.amountCents} else 0 end), 0)::text`,
            refundedCents: sql<string>`coalesce(sum(case when ${s.registrationLedger.kind} = 'REFUND' then ${s.registrationLedger.amountCents} else 0 end), 0)::text`,
          })
          .from(s.preRegistrations)
          .leftJoin(
            s.registrationLedger,
            and(
              eq(s.registrationLedger.registrationId, s.preRegistrations.id),
              sql`${s.registrationLedger.recordedAt} <= ${now.toISOString()}::timestamptz`,
            ),
          )
          .where(
            and(
              inArray(s.preRegistrations.courseId, courseIds),
              eq(s.preRegistrations.state, "ACTIVE"),
            ),
          )
          .groupBy(s.preRegistrations.id);
        // jsonb_agg yields NULL for a genuinely empty official roster.
        return {
          courses,
          groups: groups.map((group) => ({
            ...group,
            officialParticipants:
              group.officialVersion !== null &&
              group.officialParticipants === null
                ? []
                : group.officialParticipants,
          })),
          sessions,
          registrations,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read write" },
    );
  }
}
