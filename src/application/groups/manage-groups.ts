import { requireRoles } from "@/application/auth/authorize";
import type { GroupRepository } from "./group-repository";
import type { InternalUser } from "@/domain/auth/types";
import { AuthorizationError } from "@/domain/auth/errors";
import { GroupError, assertCapacity } from "@/domain/groups/rules";

function admin(user: InternalUser): void {
  if (user.status !== "ACTIVE")
    throw new AuthorizationError(
      user.status === "DISABLED" ? "DISABLED" : "NOT_INVITED",
      "Only active users can manage groups",
    );
  requireRoles(user, ["ADMIN"]);
}

function revision(value: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.toISOString() !== value)
    throw new GroupError("VALIDATION_FAILED", "La revisión no es válida.");
  return date;
}

export async function listGroups(
  repo: GroupRepository,
  user: InternalUser,
  courseId: string,
) {
  admin(user);
  return repo.list(courseId);
}

export async function createGroup(
  repo: GroupRepository,
  user: InternalUser,
  courseId: string,
  startTime: string,
  capacity: number,
) {
  admin(user);
  assertCapacity(capacity);
  return repo.create(courseId, startTime, capacity, user.id);
}

export async function changeGroupSchedule(
  repo: GroupRepository,
  user: InternalUser,
  id: string,
  startTime: string,
  expectedRevision: string,
) {
  admin(user);
  return repo.changeSchedule(
    id,
    startTime,
    user.id,
    revision(expectedRevision),
  );
}

export async function changeGroupCapacity(
  repo: GroupRepository,
  user: InternalUser,
  id: string,
  capacity: number,
  expectedRevision: string,
) {
  admin(user);
  assertCapacity(capacity);
  return repo.changeCapacity(id, capacity, user.id, revision(expectedRevision));
}

export async function cancelGroup(
  repo: GroupRepository,
  user: InternalUser,
  id: string,
  expectedRevision: string,
) {
  admin(user);
  return repo.cancel(id, user.id, revision(expectedRevision));
}
