import type { InternalUser } from "@/domain/auth/types";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { boliviaToday } from "@/domain/pre-registrations/time";
import type {
  AdminRegistrationDto,
  RegistrationFilter,
} from "@/domain/pre-registrations/types";
import { validateRegistrationId } from "@/domain/pre-registrations/validation";
import { requireRegistrationAdmin } from "./authorization";
import type {
  RegistrationExportPort,
  RegistrationRepository,
} from "./registration-repository";

export const MAX_REGISTRATION_EXPORT_ROWS = 1_000;
const PAGE_SIZE = 100;
export type RegistrationExportFormat = "CSV" | "PDF";
export interface RegistrationExportArtifact {
  readonly mediaType: "text/csv; charset=utf-8" | "application/pdf";
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly rowCount: number;
}
export class RegistrationExportLimitError extends Error {
  readonly code = "EXPORT_TOO_LARGE";
  constructor() {
    super(
      "La exportación supera 1000 registros. Filtra por curso, grupo o estado.",
    );
    this.name = "RegistrationExportLimitError";
  }
}

function validateFilter(filter: RegistrationFilter): RegistrationFilter {
  if (
    !Number.isSafeInteger(filter.page) ||
    filter.page < 1 ||
    !Number.isSafeInteger(filter.pageSize) ||
    filter.pageSize < 1 ||
    (filter.membershipStatus !== undefined &&
      !["PREINSCRITO", "INSCRITO", "SALDOVENCIDO", "CANCELADO"].includes(
        filter.membershipStatus,
      )) ||
    (filter.financialStatus !== undefined &&
      ![
        "EXEMPT",
        "UNPAID",
        "PARTIAL",
        "PAID",
        "REFUND_DUE",
        "REFUNDED",
      ].includes(filter.financialStatus)) ||
    (filter.search !== undefined &&
      (typeof filter.search !== "string" ||
        filter.search.length > 200 ||
        /\p{Cc}/u.test(filter.search)))
  )
    throw new RegistrationError(
      "VALIDATION_FAILED",
      "Revisa los filtros de exportación.",
    );
  return {
    ...filter,
    ...(filter.courseId !== undefined
      ? { courseId: validateRegistrationId(filter.courseId, "courseId") }
      : {}),
    ...(filter.groupId !== undefined
      ? { groupId: validateRegistrationId(filter.groupId, "groupId") }
      : {}),
    page: 1,
    pageSize: PAGE_SIZE,
  };
}

/** Export all matching rows, not just the UI page. Every read reauthorizes the
 * actor in the repository; a caller-supplied role alone never authorizes data.
 * Reject changed/incomplete pages rather than returning a truncated artifact.
 */
export async function exportRegistrations(
  repository: Pick<RegistrationRepository, "list">,
  renderer: RegistrationExportPort,
  actor: InternalUser | null,
  input: {
    readonly filter: RegistrationFilter;
    readonly format: RegistrationExportFormat;
  },
  clock: () => Date = () => new Date(),
): Promise<RegistrationExportArtifact> {
  requireRegistrationAdmin(actor);
  if (input.format !== "CSV" && input.format !== "PDF")
    throw new RegistrationError("VALIDATION_FAILED", "Selecciona CSV o PDF.");
  const filter = validateFilter(input.filter);
  const rows: AdminRegistrationDto[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= MAX_REGISTRATION_EXPORT_ROWS / PAGE_SIZE; page++) {
    const result = await repository.list({ ...filter, page }, actor.id);
    if (result.total > MAX_REGISTRATION_EXPORT_ROWS)
      throw new RegistrationExportLimitError();
    if (
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      (total !== undefined && total !== result.total) ||
      result.page !== page ||
      result.pageSize !== PAGE_SIZE ||
      result.items.length !== Math.min(PAGE_SIZE, result.total - rows.length)
    )
      throw new RegistrationError(
        "CONCURRENT_UPDATE",
        "La lista cambió. Vuelve a exportarla.",
      );
    total = result.total;
    for (const row of result.items) {
      if (ids.has(row.id))
        throw new RegistrationError(
          "CONCURRENT_UPDATE",
          "La lista cambió. Vuelve a exportarla.",
        );
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) break;
  }
  const date = boliviaToday(clock());
  return {
    mediaType:
      input.format === "CSV" ? "text/csv; charset=utf-8" : "application/pdf",
    filename: `preinscripciones-${date}.${input.format.toLowerCase()}`,
    bytes: await renderer.render(input.format, rows),
    rowCount: rows.length,
  };
}
