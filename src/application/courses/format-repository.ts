import type { CourseFormat, FormatValues } from "@/domain/courses/formats";

export interface FormatRepository {
  list(): Promise<readonly CourseFormat[]>;
  get(id: string): Promise<CourseFormat | null>;
  rename(
    id: string,
    name: string,
    revisionId: string,
    updatedAt: string,
    actorId: string,
  ): Promise<CourseFormat>;
  delete(
    id: string,
    revisionId: string,
    updatedAt: string,
    actorId: string,
  ): Promise<void>;
  create(
    name: string,
    values: FormatValues,
    actorId: string,
  ): Promise<CourseFormat>;
  revise(
    id: string,
    values: FormatValues,
    actorId: string,
    revisionId?: string,
    updatedAt?: string,
  ): Promise<CourseFormat>;
  setActive(
    id: string,
    active: boolean,
    actorId: string,
    revisionId?: string,
    updatedAt?: string,
  ): Promise<CourseFormat>;
}
