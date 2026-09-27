import { requireRoles } from "@/application/auth/authorize";
import type { FormatRepository } from "./format-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import { validateFormat, validateFormatName } from "@/domain/courses/formats";
import { CourseDomainError } from "@/domain/courses/errors";

function requireAdmin(user: InternalUser) {
  if (user.status !== "ACTIVE")
    throw new AuthorizationError(
      user.status === "DISABLED" ? "DISABLED" : "NOT_INVITED",
      "Only active users can manage formats",
    );
  requireRoles(user, ["ADMIN"]);
}

export async function listFormats(
  repository: FormatRepository,
  user: InternalUser,
) {
  requireAdmin(user);
  return repository.list();
}

export async function getFormat(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
) {
  requireAdmin(user);
  return repository.get(id);
}

export async function renameFormat(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  name: string,
  revisionId: string,
  updatedAt: string,
) {
  requireAdmin(user);
  return repository.rename(
    id,
    validateFormatName(name),
    revisionId,
    updatedAt,
    user.id,
  );
}

export async function deleteFormat(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  revisionId: string,
  updatedAt: string,
) {
  requireAdmin(user);
  return repository.delete(id, revisionId, updatedAt, user.id);
}

export async function createFormat(
  repository: FormatRepository,
  user: InternalUser,
  input: {
    name: string;
    totalHours: string;
    studentAmount: string;
    externalAmount: string;
    sessionMinutes?: string;
  },
) {
  requireAdmin(user);
  if (input.sessionMinutes === undefined)
    throw new CourseDomainError(
      "VALIDATION_FAILED",
      "Revisa los campos indicados.",
      { sessionMinutes: "La duración de sesión es obligatoria." },
    );
  const { name, ...values } = validateFormat(
    input.name,
    input.totalHours,
    input.studentAmount,
    input.externalAmount,
    input.sessionMinutes,
  );
  return repository.create(name, values, user.id);
}

export async function reviseFormat(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  input: {
    totalHours: string;
    studentAmount: string;
    externalAmount: string;
    sessionMinutes?: string;
  },
  revisionId?: string,
  updatedAt?: string,
) {
  requireAdmin(user);
  const { totalHours, sessionMinutes, studentAmount, externalAmount } =
    validateFormat(
      "existing",
      input.totalHours,
      input.studentAmount,
      input.externalAmount,
      input.sessionMinutes,
    );
  return repository.revise(
    id,
    {
      totalHours,
      ...(input.sessionMinutes === undefined ? {} : { sessionMinutes }),
      studentAmount,
      externalAmount,
    },
    user.id,
    revisionId,
    updatedAt,
  );
}

export async function setFormatActive(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  active: boolean,
  revisionId?: string,
  updatedAt?: string,
) {
  requireAdmin(user);
  return repository.setActive(id, active, user.id, revisionId, updatedAt);
}
