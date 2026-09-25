/** UI-only admission rules. Server validation remains authoritative. */
import { boliviaCivilToInstant } from "@/domain/courses/bolivia-time";
export type CourseInputKind = "text" | "multiline" | "grade" | "date" | "time";

export function acceptsCourseInput(
  kind: CourseInputKind,
  value: string,
): boolean {
  switch (kind) {
    case "grade":
      return /^\d{0,3}$/.test(value) && (value === "" || Number(value) <= 100);
    case "date":
      if (!/^\d{0,2}(?:\/\d{0,2}(?:\/\d{0,4})?)?$/.test(value)) return false;
      {
        const [day, month] = value.split("/");
        return (!day || Number(day) <= 31) && (!month || Number(month) <= 12);
      }
    case "time":
      if (!/^\d{0,2}(?::\d{0,2})?$/.test(value)) return false;
      {
        const [hours, minutes] = value.split(":");
        return (
          (!hours || Number(hours) <= 23) && (!minutes || Number(minutes) <= 59)
        );
      }
    case "multiline":
      // Deliberately reject non-printing input while keeping tabs/newlines.
      // eslint-disable-next-line no-control-regex
      return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
    case "text":
      // eslint-disable-next-line no-control-regex
      return !/[\u0000-\u001f\u007f]/u.test(value);
  }
}

/** Reject a whole edit rather than stripping characters or changing the cursor unexpectedly. */
export function nextCourseInput(
  kind: CourseInputKind,
  previous: string,
  candidate: string,
): string {
  return acceptsCourseInput(kind, candidate) ? candidate : previous;
}

export const requiredCourseFields = [
  "name",
  "description",
  "level",
  "courseTypeId",
  "schedule",
  "conditions",
  "startsAt",
  "endsAt",
  "minimumGrade",
] as const;

export function draftFieldsReady(
  values: Readonly<Record<string, string>>,
): boolean {
  if (!requiredCourseFields.every((name) => values[name]?.trim())) return false;
  if (
    !/^\d{1,3}$/.test(values.minimumGrade ?? "") ||
    Number(values.minimumGrade) > 100
  )
    return false;
  const civil = (value: string) => {
    try {
      return boliviaCivilToInstant(value).getTime();
    } catch {
      return NaN;
    }
  };
  const start = civil(values.startsAt ?? "");
  const end = civil(values.endsAt ?? "");
  if (!(start < end)) return false;
  const registrationStart = values.registrationStartAt ?? "";
  const registrationEnd = values.registrationEndAt ?? "";
  if (Boolean(registrationStart) !== Boolean(registrationEnd)) return false;
  if (registrationStart && !(civil(registrationStart) < civil(registrationEnd)))
    return false;
  return true;
}
