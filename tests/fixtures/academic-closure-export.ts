import type { ClosureVersionDto } from "@/domain/academic-closure/types";
export const exportId = "11111111-1111-4111-8111-111111111111";
export function closureExportFixture(): ClosureVersionDto {
  const id = exportId;
  return {
    id,
    version: 1,
    closedAt: "2026-10-07T12:30:00Z",
    actorId: id,
    actorName: "Responsable histórico Ñúñez",
    report: {
      access: "ADMIN",
      courseId: id,
      groupId: id,
      courseName: "Álgebra sintética",
      groupName: "Grupo QA",
      instructorId: id,
      instructorName: "Instructora histórica",
      minimumGrade: 70,
      scheme: {
        revision: 1,
        frozenAt: "2026-10-01T00:00:00Z",
        modality: "THEORY",
        canEdit: false,
        components: [
          {
            id,
            name: "Evaluación teórica",
            type: "THEORY",
            weight: "100",
            order: 0,
          },
        ],
      },
      attendanceSettings: {
        revision: 1,
        consecutiveAbsenceLimit: 1,
        updatedAt: "2026-10-01T00:00:00Z",
      },
      participants: [
        {
          participantId: id,
          registrationId: id,
          groupId: id,
          firstName: "María sintética",
          lastName: "Muñoz",
          ci: "001234QA",
          balanceCents: 12345,
          membershipStatus: "INSCRITO",
          canGrade: false,
          grades: [
            {
              componentId: id,
              score: "70",
              revision: 1,
              recordedBy: id,
              recordedAt: "2026-10-01T00:00:00Z",
            },
          ],
          result: {
            status: "COMPLETE",
            finalGrade: "70.00",
            decisionGrade: "70.00",
            passed: true,
            missingComponentIds: [],
          },
          attendance: {
            present: 1,
            absent: 2,
            excused: 0,
            pending: 0,
            consecutiveAbsences: 2,
            maximumConsecutiveAbsences: 2,
            warning: true,
            academicallyEligible: false,
          },
          academicallyPassed: false,
        },
      ],
      sessions: [],
    },
  };
}
