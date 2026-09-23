import type { CourseRepository } from "@/application/courses/course-repository";
import type { PublicCourseDto } from "@/domain/courses/types";

export const PUBLIC_COURSE_RETRY_DELAYS = [150, 400] as const;

type Sleep = (milliseconds: number) => Promise<void>;

export interface PublicCourseLoadOptions {
  readonly isTransientError: (error: unknown) => boolean;
  readonly sleep?: Sleep;
}

const wait: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function loadPublicCourses(
  repository: Pick<CourseRepository, "listPublic">,
  options: PublicCourseLoadOptions,
): Promise<readonly PublicCourseDto[]> {
  const sleep = options.sleep ?? wait;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await repository.listPublic();
    } catch (error) {
      const delay = PUBLIC_COURSE_RETRY_DELAYS[attempt];
      if (delay === undefined || !options.isTransientError(error)) throw error;
      await sleep(delay);
    }
  }
}
