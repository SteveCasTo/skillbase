import type {
  AdminCourseDto,
  AdminCourseCardDto,
  CourseData,
  CourseStatus,
  PublicCourseDto,
} from "@/domain/courses/types";

export interface CourseRepository {
  create(
    input: CourseData,
    actorId: string,
    request?: { key: string; fingerprint: string },
  ): Promise<AdminCourseDto & { creationRevision?: Date }>;
  update(
    id: string,
    input: CourseData,
    actorId: string,
    expectedUpdatedAt: Date,
  ): Promise<AdminCourseDto>;
  transition(
    id: string,
    next: CourseStatus,
    actorId: string,
    expectedUpdatedAt?: Date,
  ): Promise<AdminCourseDto>;
  setFeatured(
    id: string,
    actorId: string,
    expectedUpdatedAt?: Date,
  ): Promise<AdminCourseDto>;
  listAdmin(now?: Date): Promise<readonly AdminCourseCardDto[]>;
  getAdmin(id: string): Promise<AdminCourseDto | null>;
  listPublic(now?: Date): Promise<readonly PublicCourseDto[]>;
  getPublic(slug: string, now?: Date): Promise<PublicCourseDto | null>;
}
