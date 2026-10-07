import type { MembershipStatus } from "@/domain/pre-registrations/types";

export type EvaluationType = "THEORY" | "PRACTICAL";
export interface EvaluationComponentInput {
  id: string;
  name: string;
  type: EvaluationType;
  /** Decimal text in 0–100, at most two fractional digits. */
  weight: string;
}
export interface EvaluationComponentDto extends EvaluationComponentInput {
  order: number;
}
export interface EvaluationSchemeDto {
  revision: number;
  frozenAt: string | null;
  modality: EvaluationType | "MIXED" | null;
  components: EvaluationComponentDto[];
  canEdit: boolean;
}
export interface EvaluationGradeDto {
  componentId: string;
  score: string | null;
  revision: number;
  recordedBy: string | null;
  recordedByName?: string | null;
  recordedAt: string | null;
}
export interface EvaluationResultDto {
  status: "PENDING" | "COMPLETE";
  finalGrade: string | null;
  /** Incomplete evaluations explicitly count as zero, not an exemption. */
  decisionGrade: string;
  passed: boolean;
  missingComponentIds: string[];
}
export interface EvaluationParticipantDto {
  participantId: string;
  registrationId: string;
  groupId: string;
  firstName: string;
  lastName: string;
  membershipStatus: MembershipStatus;
  canGrade: boolean;
  grades: EvaluationGradeDto[];
  result: EvaluationResultDto;
}
export interface CourseEvaluationsDto {
  courseId: string;
  courseName: string;
  startsAt: string;
  minimumGrade: number;
  provisional: true;
  groupId?: string;
  unavailableReason?: string | null;
  /** Sanitized administrative correction history, never contact or financial data. */
  history?: {
    participantId: string;
    componentId: string;
    fromScore: string | null;
    toScore: string;
    revision: number;
    actorName: string | null;
    recordedAt: string;
  }[];
  scheme: EvaluationSchemeDto;
  groups: { id: string; label: string }[];
  participants: EvaluationParticipantDto[];
}
export interface EvaluationCommand {
  requestKey: string;
  courseId: string;
  groupId?: string;
  schemeRevision: number;
}
export interface SaveEvaluationSchemeInput extends EvaluationCommand {
  components: readonly EvaluationComponentInput[];
}
export interface SaveEvaluationGradeInput extends EvaluationCommand {
  registrationId: string;
  componentId: string;
  gradeRevision: number;
  score: string;
}
export interface SaveEvaluationRowInput extends EvaluationCommand {
  registrationId: string;
  grades: readonly {
    componentId: string;
    gradeRevision: number;
    score: string;
  }[];
}
export type EvaluationCommandResult =
  | {
      kind: "row";
      schemeRevision: number;
      participantId: string;
      registrationId: string;
      grades: EvaluationGradeDto[];
      result: EvaluationResultDto;
    }
  | { kind: "scheme"; schemeRevision: number }
  | {
      kind: "grade";
      schemeRevision: number;
      participantId: string;
      componentId: string;
      gradeRevision: number;
      result: EvaluationResultDto;
    };
