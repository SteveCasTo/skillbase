import { InterestError } from "@/domain/interests/rules";
import type { InterestStatus } from "@/domain/interests/types";

/** Omitted status is the historical Todos URL; never widen invalid filters. */
export function parseInterestFilter(
  params: URLSearchParams,
): InterestStatus | undefined {
  const values = params.getAll("status");
  if (values.length === 0) return undefined;
  if (values.length === 1) {
    if (values[0] === "ALL") return undefined;
    if (values[0] === "ACTIVE" || values[0] === "CANCELLED") return values[0];
  }
  throw new InterestError(
    "INVALID_REQUEST",
    400,
    "El filtro no es válido. Elige Todos, Activos o Cancelados.",
  );
}
