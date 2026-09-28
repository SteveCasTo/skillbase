import type { CourseInput } from "@/domain/courses/validation";
import { GROUP_SCHEDULE } from "@/domain/courses/weekday-schedule";

export function courseInputFromFormData(formData: FormData): CourseInput {
  const fields = [
    "name",
    "description",
    "level",
    "courseTypeId",
    "contentMarkdown",
    "instructorName",
    "artwork",
    "schedule",
    "weekdays",
    "conditions",
    "startsAt",
    "endsAt",
    "registrationStartAt",
    "registrationEndAt",
    "registrationStartDate",
    "registrationEndDate",
    "minimumGrade",
    "revision",
    "startDate",
    "endDate",
  ] as const;
  const values: CourseInput = Object.fromEntries(
    fields
      .filter(
        (field) =>
          (field !== "weekdays" || formData.has(field)) &&
          (!field.startsWith("registration") ||
            !field.endsWith("Date") ||
            formData.has(field)),
      )
      .map((field) => {
        const value = formData.get(field);
        return [field, typeof value === "string" ? value : ""];
      }),
  );
  if (formData.has("startDate") || formData.has("endDate"))
    return {
      ...values,
      startsAt: `${values.startDate ?? ""}T00:00`,
      // The hydrated weekday planner submits the calculated civil datetime in
      // endsAt; endDate exists only in the no-JavaScript fallback.
      endsAt: values.endDate
        ? `${values.endDate}T23:59`
        : (values.endsAt ?? ""),
      schedule: GROUP_SCHEDULE,
      weekdays: "1,2,3,4,5",
    };
  return values;
}
