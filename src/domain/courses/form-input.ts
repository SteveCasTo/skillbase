import { instantToBoliviaCivil } from "./bolivia-time";
import type { AdminCourseDto } from "./types";
import type { CourseInput } from "./validation";

const civil = (date: Date | null) => (date ? instantToBoliviaCivil(date) : "");

/** Server snapshot for rendering and restoring omitted disabled controls. */
export function courseFormInput(item: AdminCourseDto): CourseInput {
  const dateOnly =
    item.weekdaysMask === 31 &&
    civil(item.startsAt).endsWith("T00:00") &&
    civil(item.endsAt).endsWith("T23:59") &&
    (!item.registrationStartAt ||
      civil(item.registrationStartAt).endsWith("T00:00")) &&
    (!item.registrationEndAt ||
      civil(item.registrationEndAt).endsWith("T00:00"));
  return {
    name: item.name,
    description: item.description,
    level: item.level,
    courseTypeId: item.courseTypeId,
    contentMarkdown: item.contentMarkdown ?? "",
    instructorId: item.instructorId ?? "",
    artwork: item.artwork ?? "",
    schedule: item.schedule,
    ...(item.weekdaysMask === 31 ? { weekdays: "1,2,3,4,5" } : {}),
    conditions: item.conditions,
    startsAt: civil(item.startsAt),
    endsAt: civil(item.endsAt),
    ...(dateOnly
      ? {
          registrationStartDate: civil(item.registrationStartAt).slice(0, 10),
          registrationEndDate: item.registrationEndAt
            ? civil(
                new Date(item.registrationEndAt.getTime() - 86400000),
              ).slice(0, 10)
            : "",
        }
      : {
          registrationStartAt: civil(item.registrationStartAt),
          registrationEndAt: civil(item.registrationEndAt),
        }),
    minimumGrade: String(item.minimumGrade),
  };
}

export function restoreDisabledCourseFields(
  input: CourseInput,
  course: AdminCourseDto,
): CourseInput {
  const original = courseFormInput(course);
  // A control may have been disabled at render time and become editable before
  // this fresh read (for example, deletion of the last pristine draft group).
  // Omission never means clearing a protected value, regardless of that race.
  const fields = [
    "courseTypeId",
    "instructorId",
    "startsAt",
    "endsAt",
    "schedule",
    "weekdays",
  ];
  // Explicit attempted changes are NOT overwritten: command guards reject them.
  return {
    ...Object.fromEntries(
      fields
        .filter((field) => input[field] === undefined)
        .map((field) => [field, original[field]]),
    ),
    ...input,
  };
}
