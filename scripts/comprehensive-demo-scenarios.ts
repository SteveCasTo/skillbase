import {
  comprehensiveDemoId,
  realisticInstructorNames,
  type ComprehensiveDemoPlan,
} from "./comprehensive-demo-plan";

/** Human-readable QA inventory; identifiers are fixture keys, never credentials. */
export function comprehensiveScenarioMatrix(plan: ComprehensiveDemoPlan) {
  return plan.samples.map((sample) => {
    const group = sample.groups[0]!;
    const base = `/app/cursos/${sample.course.id}/grupos/${group.id}`;
    return {
      key: sample.key,
      courseId: sample.course.id,
      course: sample.course.name,
      instructor: realisticInstructorNames[sample.teacher]!.join(" "),
      officialStartsAt: sample.course.startsAt.toISOString(),
      officialEndsAt: sample.course.endsAt.toISOString(),
      registrationStartAt: sample.course.registrationStartAt.toISOString(),
      registrationEndAt: sample.course.registrationEndAt.toISOString(),
      status: sample.course.status,
      routes: {
        public: `/cursos/${sample.course.slug}`,
        course: `/app/cursos/${sample.course.id}`,
        groups: `/app/cursos/${sample.course.id}/grupos`,
        attendance: `${base}/sesiones`,
        evaluations: `${base}/evaluaciones`,
        closure: `${base}/cierre`,
        certificates: `${base}/certificados`,
      },
      expected:
        sample.key === "closed"
          ? "CLOSED v1; grades/attendance blocked, eligible certificate generation"
          : sample.key === "reclosed"
            ? "CLOSED v2; v1 and reopening retained, current-version generation only"
            : sample.key === "pending"
              ? "OPEN; GRADES_PENDING and ATTENDANCE_PENDING block closure"
              : sample.key === "current"
                ? "OPEN; future sessions and incomplete grades block closure"
                : sample.course.status === "ARCHIVED"
                  ? "Historical readonly course; no public detail or new registration"
                  : sample.course.status === "DRAFT"
                    ? "Unpublished; public detail 404, review before publishing"
                    : sample.course.registrationStartAt > plan.now
                      ? "UPCOMING; public interest and registration unavailable until opening"
                      : "OPEN registration; instructor roster unavailable before official start",
      participants: sample.registrations.map((registration) => ({
        key: registration.key,
        registrationRequestKey: comprehensiveDemoId(
          `registration:${registration.key}`,
        ),
        name: `${registration.participant.firstName} ${registration.participant.paternalSurname} ${registration.participant.maternalSurname}`,
        scenario: registration.scenario,
        expected:
          registration.scenario === "failed"
            ? "Completed below 70; academically ineligible"
            : registration.scenario === "zero"
              ? "Explicit 0.00 is a grade, not missing evidence"
              : registration.scenario === "boundary"
                ? "70.00 passes the threshold"
                : registration.scenario === "warning"
                  ? `N=${plan.limit} consecutive absences; warning, still eligible`
                  : registration.scenario === "ineligible"
                    ? `N+1=${plan.limit + 1} absences; attendance ineligible despite passing grades`
                    : registration.scenario === "pending"
                      ? "Entire learner row missing; cannot close"
                      : registration.scenario === "owed"
                        ? "Cancelled; actual paid cash awaits refund"
                        : registration.scenario === "refunded"
                          ? "Cancelled; recorded refund completed"
                          : registration.scenario === "transfer"
                            ? "Transferred to the second planned group, same course"
                            : registration.scenario === "partial"
                              ? plan.minimumPaymentPercent === 100
                                ? "Settings require full payment; no invented partial balance"
                                : "Minimum deposit only; outstanding balance, academic membership derives from time/payment"
                              : registration.scenario === "converted"
                                ? "Linked interest source; same global participant in another course"
                                : registration.scenario === "free"
                                  ? "Zero price; no zero-valued ledger entries"
                                  : "Valid registration under actual tariff/settings; payment history retained",
      })),
    };
  });
}
