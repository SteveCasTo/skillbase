import type { CourseInput } from "@/domain/courses/validation";

export function courseInputFromFormData(formData: FormData): CourseInput {
  const fields = [
    "name",
    "description",
    "level",
    "totalHours",
    "schedule",
    "conditions",
    "startsAt",
    "endsAt",
    "registrationStartAt",
    "registrationEndAt",
    "minimumGrade",
    "studentAmount",
    "externalAmount",
    "revision",
  ] as const;
  return Object.fromEntries(
    fields.map((field) => {
      const value = formData.get(field);
      return [field, typeof value === "string" ? value : ""];
    }),
  );
}
