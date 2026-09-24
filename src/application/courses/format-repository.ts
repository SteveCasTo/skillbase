import type { CourseFormat, FormatValues } from "@/domain/courses/formats";

export interface FormatRepository {
  list(): Promise<readonly CourseFormat[]>;
  create(
    name: string,
    values: FormatValues,
    actorId: string,
  ): Promise<CourseFormat>;
  revise(
    id: string,
    values: FormatValues,
    actorId: string,
  ): Promise<CourseFormat>;
  setActive(
    id: string,
    active: boolean,
    actorId: string,
  ): Promise<CourseFormat>;
}
