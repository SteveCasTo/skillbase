import { InterestError } from "@/domain/interests/rules";

export const interestCourseFilters = [
  { value: "WITH", label: "Con interesados" },
  { value: "WITHOUT", label: "Sin interesados" },
  { value: "ALL", label: "Todos" },
] as const;
export type InterestCourseFilter =
  (typeof interestCourseFilters)[number]["value"];

export function parseInterestFilter(
  params: URLSearchParams,
): InterestCourseFilter {
  const values = params.getAll("status");
  if (values.length === 0) return "WITH";
  if (values.length === 1) {
    const option = interestCourseFilters.find(
      (item) => item.value === values[0],
    );
    if (option) return option.value;
  }
  throw new InterestError(
    "INVALID_REQUEST",
    400,
    "El filtro no es válido. Elige Con interesados, Sin interesados o Todos.",
  );
}

export function matchesInterestCourseFilter(
  activeTotal: number,
  filter: InterestCourseFilter,
): boolean {
  return (
    filter === "ALL" ||
    (filter === "WITH" ? activeTotal > 0 : activeTotal === 0)
  );
}
