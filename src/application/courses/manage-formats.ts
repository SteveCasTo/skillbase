import { requireRoles } from "@/application/auth/authorize";
import type { FormatRepository } from "./format-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import { validateFormat } from "@/domain/courses/formats";

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

export async function createFormat(
  repository: FormatRepository,
  user: InternalUser,
  input: {
    name: string;
    totalHours: string;
    studentAmount: string;
    externalAmount: string;
  },
) {
  requireAdmin(user);
  const { name, ...values } = validateFormat(
    input.name,
    input.totalHours,
    input.studentAmount,
    input.externalAmount,
  );
  return repository.create(name, values, user.id);
}

export async function reviseFormat(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  input: { totalHours: string; studentAmount: string; externalAmount: string },
) {
  requireAdmin(user);
  const { totalHours, studentAmount, externalAmount } = validateFormat(
    "existing",
    input.totalHours,
    input.studentAmount,
    input.externalAmount,
  );
  return repository.revise(
    id,
    { totalHours, studentAmount, externalAmount },
    user.id,
  );
}

export async function setFormatActive(
  repository: FormatRepository,
  user: InternalUser,
  id: string,
  active: boolean,
) {
  requireAdmin(user);
  return repository.setActive(id, active, user.id);
}
