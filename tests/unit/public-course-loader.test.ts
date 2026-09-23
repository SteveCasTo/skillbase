import { describe, expect, test } from "bun:test";

import {
  loadPublicCourses,
  PUBLIC_COURSE_RETRY_DELAYS,
} from "@/application/courses/load-public-courses";
import type { CourseRepository } from "@/application/courses/course-repository";
import type { PublicCourseDto } from "@/domain/courses/types";
import { CourseInfrastructureError } from "@/server/db/repositories/course-infrastructure-error";
import { isTransientPublicCourseReadError } from "@/server/db/repositories/transient-course-read";

const courses: readonly PublicCourseDto[] = [];

function transient(code = "ECONNRESET") {
  return new CourseInfrastructureError("listPublic", "read failed", { code });
}

function repository(
  listPublic: () => Promise<readonly PublicCourseDto[]>,
): Pick<CourseRepository, "listPublic"> {
  return { listPublic };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

describe("public course loading retries", () => {
  test("returns a successful complete read after transient failures", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await loadPublicCourses(
      repository(async () => {
        attempts += 1;
        if (attempts < 3) throw transient();
        return courses;
      }),
      {
        isTransientError: isTransientPublicCourseReadError,
        sleep: async (delay) => void delays.push(delay),
      },
    );

    expect(result).toBe(courses);
    expect(attempts).toBe(3);
    expect(delays).toEqual([...PUBLIC_COURSE_RETRY_DELAYS]);
  });

  test("stops after exactly three total attempts", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const error = await rejection(
      loadPublicCourses(
        repository(async () => {
          attempts += 1;
          throw transient("08006");
        }),
        {
          isTransientError: isTransientPublicCourseReadError,
          sleep: async (delay) => void delays.push(delay),
        },
      ),
    );
    expect(error).toBeInstanceOf(CourseInfrastructureError);
    expect(attempts).toBe(3);
    expect(delays).toEqual([150, 400]);
  });

  test("does not retry permanent, configuration, or non-list errors", async () => {
    for (const error of [
      new CourseInfrastructureError("listPublic", "permission", {
        code: "42501",
      }),
      new CourseInfrastructureError("create", "write failed", {
        code: "ECONNRESET",
      }),
      new Error("Missing required environment variable: DATABASE_URL"),
    ]) {
      let attempts = 0;
      const delays: number[] = [];
      const caught = await rejection(
        loadPublicCourses(
          repository(async () => {
            attempts += 1;
            throw error;
          }),
          {
            isTransientError: isTransientPublicCourseReadError,
            sleep: async (delay) => void delays.push(delay),
          },
        ),
      );
      expect(caught).toBe(error);
      expect(attempts).toBe(1);
      expect(delays).toEqual([]);
    }
  });
});
