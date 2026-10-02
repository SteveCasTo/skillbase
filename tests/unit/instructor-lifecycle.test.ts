import { expect, test } from "bun:test";
import {
  lifecycleBlockReason,
  isExclusiveInstructor,
  type InstructorLifecycle,
} from "@/domain/instructors/lifecycle";
import {
  mutateInstructorLifecycle,
  type InstructorLifecycleRepository,
} from "@/application/instructors/lifecycle";
import type { InternalUser } from "@/domain/auth/types";

const state: InstructorLifecycle = {
  status: "ACTIVE",
  exclusiveInstructor: true,
  assignedHistorically: false,
  hasDependencies: false,
  deletionPending: false,
  courses: [],
};
test("lifecycle restricts every mutation to exclusively instructor accounts", () => {
  expect(isExclusiveInstructor(["INSTRUCTOR"])).toBe(true);
  expect(isExclusiveInstructor(["ADMIN", "INSTRUCTOR"])).toBe(false);
  expect(isExclusiveInstructor([])).toBe(false);
  for (const action of ["activate", "deactivate", "delete"] as const)
    expect(
      lifecycleBlockReason({ ...state, exclusiveInstructor: false }, action),
    ).toContain("otros roles");
});
test("history forbids deletion forever but archived/reassigned history permits deactivation", () => {
  expect(
    lifecycleBlockReason({ ...state, assignedHistorically: true }, "delete"),
  ).toContain("historial");
  expect(
    lifecycleBlockReason(
      { ...state, assignedHistorically: true },
      "deactivate",
    ),
  ).toBeNull();
  expect(
    lifecycleBlockReason({ ...state, hasDependencies: true }, "delete"),
  ).toContain("referencias");
  expect(
    lifecycleBlockReason(
      { ...state, courses: [{ id: "draft", name: "Draft" }] },
      "deactivate",
    ),
  ).toContain("Reasigna");
  expect(
    lifecycleBlockReason(
      { ...state, deletionPending: true, status: "DISABLED" },
      "activate",
    ),
  ).toContain("pendiente");
});
const actor: InternalUser = {
  id: "admin",
  authUserId: "auth-admin",
  name: "Synthetic",
  email: "admin@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
test("provider failures never complete deletion or reenable potentially removed credentials", async () => {
  const events: string[] = [];
  const repository: InstructorLifecycleRepository = {
    inspect: async () => state,
    setActive: async () => {
      events.push("activate");
    },
    beginDeletion: async () => {
      events.push("disabled-pending");
      return "auth-target";
    },
    completeDeletion: async () => {
      events.push("complete");
    },
  };
  await expect(
    mutateInstructorLifecycle(
      repository,
      {
        remove: async () => {
          events.push("provider");
          throw new Error("network");
        },
      },
      actor,
      "target",
      "delete",
      new Date().toISOString(),
    ),
  ).rejects.toThrow("permanece bloqueada");
  expect(events).toEqual(["disabled-pending", "provider"]);
});
test("database finalization failure does not restore access; retry can finish the durable outbox", async () => {
  let failures = 1;
  const events: string[] = [];
  const repository: InstructorLifecycleRepository = {
    inspect: async () => state,
    setActive: async () => {
      throw new Error("must never activate");
    },
    beginDeletion: async () => {
      events.push("pending");
      return "same-auth-id";
    },
    completeDeletion: async () => {
      if (failures--) throw new Error("database");
      events.push("complete");
    },
  };
  const credentials = {
    remove: async (id: string) => {
      events.push(id);
    },
  };
  await expect(
    mutateInstructorLifecycle(
      repository,
      credentials,
      actor,
      "target",
      "delete",
      new Date().toISOString(),
    ),
  ).rejects.toThrow("bloqueada");
  await mutateInstructorLifecycle(
    repository,
    credentials,
    actor,
    "target",
    "delete",
    new Date().toISOString(),
  );
  expect(events).toEqual([
    "pending",
    "same-auth-id",
    "pending",
    "same-auth-id",
    "complete",
  ]);
});
test("unauthorized actors and invalid actions never reach provider or persistence", async () => {
  const repository: InstructorLifecycleRepository = {
    inspect: async () => state,
    setActive: async () => {
      throw new Error("unexpected");
    },
    beginDeletion: async () => {
      throw new Error("unexpected");
    },
    completeDeletion: async () => {
      throw new Error("unexpected");
    },
  };
  const credentials = {
    remove: async () => {
      throw new Error("unexpected");
    },
  };
  await expect(
    mutateInstructorLifecycle(
      repository,
      credentials,
      { ...actor, roles: ["INSTRUCTOR"] },
      "target",
      "delete",
      new Date().toISOString(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    mutateInstructorLifecycle(
      repository,
      credentials,
      actor,
      "target",
      "arbitrary",
      new Date().toISOString(),
    ),
  ).rejects.toThrow("no es válida");
});
