import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";
import type { CourseStatus } from "./types";

export type CourseReportStatus = CourseStatus | "ALL";
export const courseFilters = [
  { value: "PUBLISHED", label: "Publicados" },
  { value: "DRAFT", label: "Borradores" },
  { value: "ARCHIVED", label: "Archivados" },
  { value: "ALL", label: "Todos" },
] as const;
export function courseListStatus(value: string | null): CourseReportStatus {
  return (
    courseFilters.find((option) => option.value === value)?.value ?? "PUBLISHED"
  );
}
export function matchesCourseSearch(
  course: { name: string; slug: string },
  search: string,
): boolean {
  return normalizeRegistrationSearch(`${course.name} ${course.slug}`).includes(
    normalizeRegistrationSearch(search),
  );
}
export interface CourseReportFilter {
  search: string;
  status: CourseReportStatus;
}
