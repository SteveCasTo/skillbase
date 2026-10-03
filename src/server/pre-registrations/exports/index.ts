import type { RegistrationExportPort } from "@/application/pre-registrations/registration-repository";
import { renderRegistrationsCsv } from "./csv";
import { renderRegistrationsPdf } from "./pdf";

/** Server only. HTTP owns ADMIN session binding and private/no-store attachment
 * headers. Renderers deliberately cannot query participants or authorize users.
 */
export function createRegistrationExportPort(
  clock: () => Date = () => new Date(),
): RegistrationExportPort {
  return {
    async render(format, rows) {
      if (format === "CSV") return renderRegistrationsCsv(rows);
      return renderRegistrationsPdf(rows, clock());
    },
  };
}
