import type { InternalUser } from "@/domain/auth/types";
import {
  createPriceSnapshot,
  DEFAULT_REGISTRATION_SETTINGS,
} from "@/domain/pre-registrations/money";
import type { AdminRegistrationDto } from "@/domain/pre-registrations/types";

export const exportActor: InternalUser = {
  id: "00000000-0000-4000-8000-000000000001",
  authUserId: "00000000-0000-4000-8000-000000000002",
  email: "admin@example.invalid",
  name: "Synthetic admin",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
export const exportNow = new Date("2099-03-02T02:03:00Z");
export function exportRow(index = 1): AdminRegistrationDto & {
  readonly courseName: string;
  readonly groupName: string;
} {
  return {
    id: `registration-${index}`,
    courseId: "00000000-0000-4000-8000-000000000003",
    groupId: "00000000-0000-4000-8000-000000000004",
    courseName: "Diseño y programación",
    groupName: "Grupo mañana",
    participant: {
      id: "participant-private",
      revision: exportNow.toISOString(),
      firstName: "María José",
      lastName: "Muñoz",
      ci: "000123-LP",
      email: "participant-private@example.invalid",
      phone: "70000001",
    },
    state: "ACTIVE",
    membershipStatus: "PREINSCRITO",
    price: createPriceSnapshot({
      participantType: "STUDENT",
      courseTypeRevisionId: "private-tariff",
      studentAmount: "80.01",
      externalAmount: "100.00",
      settings: DEFAULT_REGISTRATION_SETTINGS,
    }),
    paidCents: 2001,
    refundedCents: 0,
    balanceCents: 6000,
    refundDueCents: 0,
    financialStatus: "PARTIAL",
    sourceInterestId: "private-interest",
    firstDayException: false,
    cancellationReason: null,
    cancelledAt: null,
    revision: exportNow.toISOString(),
    createdAt: exportNow.toISOString(),
    paymentDeadlineExclusive: "2099-03-03T04:00:00Z",
  };
}
