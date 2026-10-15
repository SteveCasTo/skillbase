import type {
  AdminInterestCourseDto,
  AdminInterestMutationInput,
  AdminInterestPostPayload,
  AdminInterestSummaryDto,
  PublicInterestFormDto,
  RegisterInterestInput,
} from "@/domain/interests/types";
export interface InterestRepository {
  publicForm(slug: string): Promise<PublicInterestFormDto | null>;
  register(slug: string, input: Required<RegisterInterestInput>): Promise<void>;
  summary(): Promise<AdminInterestSummaryDto[]>;
  course(courseId: string): Promise<AdminInterestCourseDto | null>;
  mutate(
    courseId: string,
    input: AdminInterestMutationInput,
    actorId: string,
  ): Promise<AdminInterestPostPayload>;
}
