export const COURSE_LEVELS = ["BASIC", "INTERMEDIATE", "ADVANCED"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const PARTICIPANT_TYPES = ["STUDENT", "EXTERNAL"] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];
export type RegistrationAvailability =
  "UNAVAILABLE" | "UPCOMING" | "OPEN" | "CLOSED";

export interface CoursePrice {
  readonly participantType: ParticipantType;
  readonly amount: string;
  readonly currency: "BOB";
}

export interface CourseData {
  readonly courseTypeId: string;
  readonly name: string;
  readonly description: string;
  readonly level: CourseLevel;
  readonly schedule: string;
  readonly conditions: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly registrationStartAt: Date | null;
  readonly registrationEndAt: Date | null;
  readonly minimumGrade: number;
  readonly contentMarkdown: string | null;
  readonly instructorName: string | null;
  readonly artwork: string | null;
}

export interface Course extends CourseData {
  readonly courseTypeRevisionId: string;
  readonly totalHours: number;
  readonly prices: readonly CoursePrice[];
  readonly featured: boolean;
  readonly id: string;
  readonly slug: string;
  readonly status: CourseStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminCourseDto extends Course {
  readonly registrationAvailability: RegistrationAvailability;
}

export interface PublicCourseDto {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly contentMarkdown?: string | null;
  readonly instructorName?: string | null;
  readonly artwork?: string | null;
  readonly featured?: boolean;
  readonly level: CourseLevel;
  readonly totalHours: number;
  readonly schedule: string;
  readonly conditions: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly registrationStartAt: Date | null;
  readonly registrationEndAt: Date | null;
  readonly registrationAvailability: RegistrationAvailability;
  readonly prices: readonly CoursePrice[];
}
