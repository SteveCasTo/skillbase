import type { InternalUser } from "@/domain/auth/types";
import type { ClosureRepository } from "@/application/academic-closure/closure-repository";
import {
  getAcademicClosure,
  getAcademicClosureVersion,
} from "@/application/academic-closure/manage-closure";
import type {
  ClosureStateDto,
  ClosureVersionDto,
} from "@/domain/academic-closure/types";
import { closureFailure } from "./http";
import { getClosureRepository } from "./service";
export type ClosureLoadResult<T> =
  | { available: true; data: T }
  | {
      available: false;
      status: number;
      code: string;
      unavailableReason: string;
    };
interface LoadInput {
  actor: InternalUser;
  courseId: string;
  groupId: string;
  repository?: ClosureRepository;
}
async function load<T>(work: () => Promise<T>): Promise<ClosureLoadResult<T>> {
  try {
    return { available: true, data: await work() };
  } catch (error) {
    const failure = closureFailure(error);
    return {
      available: false,
      status: failure.status,
      code: failure.payload.code,
      unavailableReason: failure.payload.message,
    };
  }
}
export function loadAcademicClosure(
  input: LoadInput,
): Promise<ClosureLoadResult<ClosureStateDto>> {
  return load(() =>
    getAcademicClosure(
      input.repository ?? getClosureRepository(),
      input.actor,
      input.courseId,
      input.groupId,
    ),
  );
}
export function loadAcademicClosureVersion(
  input: LoadInput & { version: number },
): Promise<ClosureLoadResult<ClosureVersionDto>> {
  return load(() =>
    getAcademicClosureVersion(
      input.repository ?? getClosureRepository(),
      input.actor,
      input.courseId,
      input.groupId,
      input.version,
    ),
  );
}
