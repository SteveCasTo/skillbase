import type { AdminCourseDto } from "@/domain/courses/types";

export const certificateCourseFilters = [
  { value: "ACTIVE", label: "Activos" },
  { value: "ARCHIVED", label: "Archivados" },
  { value: "ALL", label: "Todos" },
] as const;
export type CertificateCourseFilter =
  (typeof certificateCourseFilters)[number]["value"];

export function parseCertificateCourseFilter(
  value: string | null,
): CertificateCourseFilter {
  if (value === null) return "ACTIVE";
  const option = certificateCourseFilters.find(
    (option) => option.value === value,
  );
  if (!option) throw new Error("Selecciona Activos, Archivados o Todos.");
  return option.value;
}

/** Editorial state only: academic eligibility must already have been enforced. */
export function matchesCertificateCourseFilter(
  status: AdminCourseDto["status"],
  selected: CertificateCourseFilter,
): boolean {
  return (
    selected === "ALL" ||
    (selected === "ARCHIVED" ? status === "ARCHIVED" : status !== "ARCHIVED")
  );
}
