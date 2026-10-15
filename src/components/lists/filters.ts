export { courseFilters } from "@/domain/courses/report-filters";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";

export interface ListFilterOption {
  readonly value: string;
  readonly label: string;
}

export const accountFilters = [
  { value: "ACTIVE", label: "Activos" },
  { value: "INVITED", label: "Invitados" },
  { value: "DISABLED", label: "Desactivados" },
  { value: "ALL", label: "Todos" },
] as const satisfies readonly {
  value: AdminAccountDto["status"] | "ALL";
  label: string;
}[];

export function selectedListFilter(
  value: string | null,
  options: readonly ListFilterOption[],
): string {
  return (
    options.find((option) => option.value === value)?.value ??
    options[0]?.value ??
    "ALL"
  );
}

export function matchesListFilter(status: string, selected: string): boolean {
  return selected === "ALL" || status === selected;
}
