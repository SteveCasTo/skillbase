import { describe, expect, test } from "bun:test";
import { handleRegistrationPost } from "@/server/pre-registrations/http";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import { exportActor as actor, exportRow } from "./registration-export-fixture";

const siteUrl = new URL("http://127.0.0.1:4999");
const registrationId = "00000000-0000-4000-8000-000000000010";
const participantId = "00000000-0000-4000-8000-000000000011";
const otherId = "00000000-0000-4000-8000-000000000012";
const participant = { ...exportRow().participant, id: participantId };
const detail = {
  registration: { ...exportRow(), id: registrationId, participant },
  ledger: [],
};
const values = {
  ...participant,
  phone: participant.phone ?? "",
  participantId,
  requestKey: "00000000-0000-4000-8000-000000000013",
  firstName: "Editada",
};
// Only HTTP/application calls are exercised; persistence owns fresh actor locks.
async function unexpected(): Promise<never> {
  throw new Error("Unexpected repository call");
}
function repository(
  overrides: Partial<RegistrationRepository> = {},
): RegistrationRepository {
  return {
    form: unexpected,
    create: unexpected,
    updateParticipant: unexpected,
    recordPayment: unexpected,
    recordRefund: unexpected,
    cancel: unexpected,
    transfer: unexpected,
    settings: unexpected,
    updateSettings: unexpected,
    list: unexpected,
    detail: unexpected,
    findParticipants: unexpected,
    instructorRoster: unexpected,
    ...overrides,
  };
}
function request(
  overrides: Record<string, string> = {},
  origin = siteUrl.origin,
) {
  const { id: _id, ...body } = values;
  void _id;
  return new Request(
    `${siteUrl.origin}/app/preinscripciones/${registrationId}?operation=participant`,
    {
      method: "POST",
      headers: { Origin: origin, Accept: "application/json" },
      body: new URLSearchParams({ ...body, ...overrides }),
    },
  );
}
const base = {
  actor,
  siteUrl,
  registrationId,
  operation: "participant" as const,
};

describe("participant editing in registration context", () => {
  test("requires a registration context, never an independent participant target", async () => {
    const result = await handleRegistrationPost({
      actor,
      siteUrl,
      operation: "participant",
      request: request(),
      repository: repository(),
    });
    expect(result.status).toBe(422);
  });
  test("resolves the current association and reuses the global participant mutation", async () => {
    const calls: string[] = [];
    const result = await handleRegistrationPost({
      ...base,
      request: request(),
      repository: repository({
        detail: async (id, actorId) => {
          expect(id).toBe(registrationId);
          expect(actorId).toBe(actor.id);
          calls.push("read");
          return detail;
        },
        updateParticipant: async (input, actorId) => {
          expect(actorId).toBe(actor.id);
          expect(input.participantId).toBe(participantId);
          expect(input.revision).toBe(participant.revision);
          expect(input.participant.firstName).toBe("Editada");
          calls.push("write");
          return { ...participant, firstName: "Editada" };
        },
      }),
    });
    expect(calls).toEqual(["read", "write"]);
    expect(result.payload).toMatchObject({
      ok: true,
      value: {
        kind: "participant",
        participant: { id: participantId, firstName: "Editada" },
      },
    });
  });
  test("rejects missing registrations and spoofed participants without any write", async () => {
    const missing = await handleRegistrationPost({
      ...base,
      request: request(),
      repository: repository({ detail: async () => null }),
    });
    expect(missing.status).toBe(404);
    for (const currentId of [participantId, otherId]) {
      const result = await handleRegistrationPost({
        ...base,
        request: request({
          participantId: currentId === participantId ? otherId : participantId,
        }),
        repository: repository({
          detail: async () => ({
            ...detail,
            registration: {
              ...detail.registration,
              participant: { ...participant, id: currentId },
            },
          }),
        }),
      });
      expect(result.status).toBe(422);
      expect(result.payload).toMatchObject({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });
  test("role/origin checks and fresh repository authorization precede mutation", async () => {
    for (const restrictedActor of [
      { ...actor, roles: ["INSTRUCTOR"] as const },
      { ...actor, status: "DISABLED" as const },
    ]) {
      const result = await handleRegistrationPost({
        ...base,
        actor: restrictedActor,
        request: request(),
        repository: repository(),
      });
      expect(result.status).toBe(403);
    }
    expect(
      (
        await handleRegistrationPost({
          ...base,
          request: request({}, "https://invalid.example"),
          repository: repository(),
        })
      ).status,
    ).toBe(403);
    const result = await handleRegistrationPost({
      ...base,
      request: request(),
      repository: repository({
        detail: async () => {
          throw new RegistrationError("FORBIDDEN", "Actor no vigente.");
        },
      }),
    });
    expect(result.status).toBe(403);
  });
  test("preserves attempted values when the global revision is stale", async () => {
    const result = await handleRegistrationPost({
      ...base,
      request: request(),
      repository: repository({
        detail: async () => detail,
        updateParticipant: async () => {
          throw new RegistrationError(
            "CONCURRENT_UPDATE",
            "Revisa los datos actuales.",
          );
        },
      }),
    });
    expect(result.status).toBe(409);
    expect(result.values.firstName).toBe("Editada");
    expect(result.values.revision).toBe(participant.revision);
  });
});
