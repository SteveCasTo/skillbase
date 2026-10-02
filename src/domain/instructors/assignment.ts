import { CourseDomainError } from "@/domain/courses/errors";

export function assertInstructorChange(
  previousId: string | null,
  nextId: string | null,
  startsAt: Date,
  now = new Date(),
): void {
  if (previousId && !nextId)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Un curso asignado debe conservar un instructor. Selecciona otro instructor activo para reemplazarlo.",
      {
        instructorId:
          "Selecciona un instructor activo; no se puede quitar la asignación.",
      },
    );
  if (previousId !== nextId && startsAt.getTime() <= now.getTime())
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "No se puede cambiar el instructor desde el inicio oficial.",
      { instructorId: "El curso ya inició." },
    );
}
