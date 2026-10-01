export type InterestStatus = "ACTIVE" | "CANCELLED";
export type RegisterInterestInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  preferredGroupId?: string | null;
};
export type InterestFormValues = Record<keyof RegisterInterestInput, string>;
export type InterestIssues = Partial<
  Record<keyof RegisterInterestInput, string>
>;
export type PublicInterestFormDto = {
  available: boolean;
  closesAt: string;
  groups: { id: string; startTime: string; endTime: string }[];
};
export type AdminInterestRegistrationDto = {
  id: string;
  courseId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredGroupId: string | null;
  status: InterestStatus;
  createdAt: string;
  updatedAt: string;
};
export type AdminInterestMetricsDto = {
  courseId: string;
  activeTotal: number;
  byPreference: { preferredGroupId: string | null; activeCount: number }[];
};
export type AdminInterestSummaryDto = {
  courseId: string;
  name: string;
  activeTotal: number;
};
export type AdminInterestCourseDto = {
  course: { id: string; name: string };
  registrations: AdminInterestRegistrationDto[];
  metrics: AdminInterestMetricsDto;
  groups: {
    id: string;
    startTime: string;
    endTime: string;
    status: "PLANNED" | "CANCELLED";
  }[];
};
export type AdminInterestMutationInput = {
  intent: "cancel" | "reactivate";
  interestRegistrationId: string;
  revision: string;
};
export type PublicInterestPostPayload =
  | { ok: true; message: string }
  | { ok: false; code: string; message: string; issues: InterestIssues };
export type AdminInterestPostPayload =
  | {
      ok: true;
      registration: AdminInterestRegistrationDto;
      metrics: AdminInterestMetricsDto;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues?: Record<string, string>;
      registration?: AdminInterestRegistrationDto;
      metrics?: AdminInterestMetricsDto;
    };
