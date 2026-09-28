import { describe, expect, test } from "bun:test";
import { planDemoCourses } from "../../scripts/seed-demo";
import { instantToBoliviaCivil } from "@/domain/courses/bolivia-time";
import {
  GROUP_SCHEDULE,
  planCourseDates,
} from "@/domain/courses/weekday-schedule";
import { groupPlan, overlaps } from "@/domain/groups/rules";

const revisions = new Map<
  string,
  { revisionId: string; totalHours: number; sessionMinutes: number | null }
>([
  [
    "Formato 20 horas",
    { revisionId: "20h", totalHours: 20, sessionMinutes: 90 },
  ],
  [
    "Formato 30 horas",
    { revisionId: "30h", totalHours: 30, sessionMinutes: 150 },
  ],
]);

describe("development demo course planning", () => {
  test("plans all demos on Bolivia weekdays with date-only boundaries, group times and valid windows", () => {
    const now = new Date("2027-11-13T02:00:00Z"); // Friday in Bolivia, Saturday in UTC
    const planned = planDemoCourses(now, revisions);
    expect(planned).toHaveLength(5);
    expect(planned.map(({ course }) => course.slug)).toEqual([
      "demo-programacion-web",
      "demo-analisis-de-datos",
      "demo-diseno-de-interfaces",
      "demo-ciberseguridad-basica",
      "demo-gestion-de-proyectos",
    ]);
    for (const { course, groups } of planned) {
      const start = instantToBoliviaCivil(course.startsAt);
      const end = instantToBoliviaCivil(course.endsAt);
      expect(start.slice(11)).toBe("00:00");
      expect(end.slice(11)).toBe("23:59");
      expect(course.schedule).toBe(GROUP_SCHEDULE);
      expect(course.weekdaysMask).toBe(31);
      expect(course.startsAt > now).toBe(true);
      expect(
        new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay(),
      ).toBeGreaterThan(0);
      expect(
        new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay(),
      ).toBeLessThan(6);
      const revision = [...revisions.values()].find(
        (item) => item.revisionId === course.courseTypeRevisionId,
      )!;
      if (revision.sessionMinutes === null)
        throw new Error("Missing fixture minutes");
      expect(
        planCourseDates({
          startDate: start.slice(0, 10),
          weekdaysMask: 31,
          totalHours: revision.totalHours,
          sessionMinutes: revision.sessionMinutes,
        }).endsAt,
      ).toEqual(course.endsAt);
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.capacity).toBeGreaterThan(0);
        const time = instantToBoliviaCivil(group.startsAt).slice(11);
        expect(groupPlan(course, revision, time).endsAt).toEqual(group.endsAt);
        expect(group.startsAt >= course.startsAt).toBe(true);
        expect(group.endsAt <= course.endsAt).toBe(true);
      }
      for (let index = 0; index < groups.length; index++) {
        for (const other of groups.slice(index + 1)) {
          expect(
            overlaps(
              groups[index]!.startsAt,
              groups[index]!.endsAt,
              other.startsAt,
              other.endsAt,
            ),
          ).toBe(false);
        }
      }
      if (course.registrationStartAt && course.registrationEndAt) {
        expect(course.registrationStartAt < course.registrationEndAt).toBe(
          true,
        );
        expect(course.registrationEndAt < course.startsAt).toBe(true);
        expect(
          instantToBoliviaCivil(course.registrationStartAt).slice(11),
        ).toBe("00:00");
        expect(instantToBoliviaCivil(course.registrationEndAt).slice(11)).toBe(
          "00:00",
        );
      } else {
        expect(course.registrationStartAt).toBeNull();
        expect(course.registrationEndAt).toBeNull();
      }
    }
  });

  test("skips existing slugs entirely, including edited courses with different format terms", () => {
    const existing = new Set([
      "demo-programacion-web",
      "demo-analisis-de-datos",
    ]);
    const changed = new Map(revisions);
    changed.set("Formato 20 horas", {
      revisionId: "edited",
      totalHours: 15,
      sessionMinutes: null,
    });
    expect(() =>
      planDemoCourses(new Date("2027-01-01T12:00:00Z"), changed, existing),
    ).toThrow("Seed format needs session minutes");
    const allExisting = new Set(
      planDemoCourses(new Date("2027-01-01T12:00:00Z"), revisions).map(
        ({ course }) => course.slug,
      ),
    );
    expect(
      planDemoCourses(new Date("2027-01-01T12:00:00Z"), changed, allExisting),
    ).toEqual([]);
    const remaining = planDemoCourses(
      new Date("2027-01-01T12:00:00Z"),
      revisions,
      existing,
    );
    expect(remaining.map(({ course }) => course.slug)).toEqual([
      "demo-diseno-de-interfaces",
      "demo-ciberseguridad-basica",
      "demo-gestion-de-proyectos",
    ]);
  });

  test("rejects modified format terms when a group session crosses midnight", () => {
    const changed = new Map(revisions);
    changed.set("Formato 20 horas", {
      revisionId: "edited",
      totalHours: 20,
      sessionMinutes: 480,
    });
    // 09:00–17:00 and 18:00–02:00: the latter must fail same-day validation.
    expect(() =>
      planDemoCourses(new Date("2027-01-01T12:00:00Z"), changed),
    ).toThrow();
  });
});
