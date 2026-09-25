import type { CourseInput } from "@/domain/courses/validation";

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
    "conditions",
    "startsAt",
    "endsAt",
    "registrationStartAt",
    "registrationEndAt",
    "minimumGrade",
    "revision",
  ] as const;
  return Object.fromEntries(
    fields.map((field) => {
      const value = formData.get(field);
      return [field, typeof value === "string" ? value : ""];
    }),
  );
}
