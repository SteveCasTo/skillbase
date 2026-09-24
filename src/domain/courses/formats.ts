import { CourseDomainError } from "./errors";
import { money } from "./validation";

export interface FormatValues {
  readonly totalHours: number;
  readonly studentAmount: string;
  readonly externalAmount: string;
}

export interface CourseFormat extends FormatValues {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly revisionId: string;
  readonly revisionNumber: number;
}

export function validateFormat(
  nameInput: string,
  hoursInput: string,
  studentInput: string,
  externalInput: string,
) {
  const errors: Record<string, string> = {};
  const name = nameInput.trim();
  if (!name) errors.name = "El nombre es obligatorio.";
  const totalHours = Number(hoursInput);
  if (
    !/^\d+$/.test(hoursInput) ||
    !Number.isSafeInteger(totalHours) ||
    totalHours <= 0 ||
    totalHours > 2147483647
  )
    errors.totalHours = "La duración debe ser un entero positivo.";
  const studentAmount = money(
    { studentAmount: studentInput },
    "studentAmount",
    errors,
  );
  const externalAmount = money(
    { externalAmount: externalInput },
    "externalAmount",
    errors,
  );
  if (Object.keys(errors).length)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Revisa los campos indicados.",
      errors,
    );
  return { name, totalHours, studentAmount, externalAmount };
}
