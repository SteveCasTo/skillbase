import type {
  InstructorProfile,
  InstructorProfileData,
} from "@/domain/instructors/profile";

export interface InstructorRepository {
  list(): Promise<readonly InstructorProfile[]>;
  get(id: string): Promise<InstructorProfile | null>;
  update(
    id: string,
    data: InstructorProfileData,
    actorId: string,
    expected: Date,
  ): Promise<InstructorProfile>;
}
