import { expect, test, mock } from "bun:test";
import type { InternalUser } from "@/domain/auth/types";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";
import type {
  AdminAccountRepository,
  AdminCredentialGateway,
} from "@/application/admin-accounts/repository";
import {
  AdminAccountError,
  applicableAdminAction,
  validateAdminName,
} from "@/domain/admin-accounts/rules";
import {
  createAdminAccount,
  mutateAdminAccount,
} from "@/application/admin-accounts/manage-admin-accounts";
import {
  handleAdminAccountPost,
  adminAccountJson,
} from "@/server/admin-accounts/http";
import { adminCredentialGateway } from "@/server/admin-accounts/credentials";
import { createClient } from "@supabase/supabase-js";
const id = "f1000000-0000-4000-8000-000000000001";
const actor: InternalUser = {
  id,
  authUserId: id,
  name: "Synthetic Admin",
  email: "admin@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
  authPrimaryProvider: "EMAIL",
  approvedGoogleIdentityId: null,
};
const account: AdminAccountDto = {
  id,
  name: "Synthetic",
  email: "synthetic@test.invalid",
  status: "ACTIVE",
  revision: new Date().toISOString(),
  exclusiveAdmin: true,
  hasActivity: false,
  deletionPending: false,
  lifecycleBlockedReason: null,
  action: "delete",
};
const input = {
  name: " Synthetic ",
  email: " SYNTHETIC@TEST.INVALID ",
  password: "Synthetic-Password-Only",
};
function harness() {
  const repository: AdminAccountRepository = {
    authorize: mock(async () => {}),
    emailExists: mock(async () => false),
    create: mock(async () => account),
    list: mock(async () => [account]),
    get: mock(async () => account),
    rename: mock(async () => ({ account, actorActive: true, deleted: false })),
    setActive: mock(async () => ({
      account,
      actorActive: true,
      deleted: false,
    })),
    beginDeletion: mock(async () => ({
      authUserId: id,
      completed: false,
      actorActive: true,
    })),
    completeDeletion: mock(async () => ({
      account: null,
      actorActive: true,
      deleted: true,
    })),
  };
  const gateway: AdminCredentialGateway = {
    createConfirmedUser: mock(async () => id),
    removeCreatedUser: mock(async () => {}),
    deleteUser: mock(async () => {}),
  };
  return { repository, gateway };
}
test("one lifecycle action, no ROOT or self-ban, history and multirole restricted", () => {
  expect(applicableAdminAction(account)).toBe("delete");
  expect(applicableAdminAction({ ...account, hasActivity: true })).toBe(
    "deactivate",
  );
  expect(
    applicableAdminAction({
      ...account,
      hasActivity: true,
      status: "DISABLED",
    }),
  ).toBe("activate");
  expect(
    applicableAdminAction({
      ...account,
      deletionPending: true,
      status: "DISABLED",
    }),
  ).toBe("retry-delete");
  expect(
    applicableAdminAction({ ...account, exclusiveAdmin: false }),
  ).toBeNull();
  expect(applicableAdminAction({ ...account, status: "INVITED" })).toBeNull();
  expect(validateAdminName("  María  ")).toBe("María");
  for (const name of ["", "x".repeat(251), "Bad\nName"])
    expect(() => validateAdminName(name)).toThrow();
});
test("creation reauthorizes before/after Auth and stores no credential in repository/DTO", async () => {
  const { repository, gateway } = harness();
  const value = await createAdminAccount(repository, gateway, actor, input);
  expect(repository.authorize).toHaveBeenCalledTimes(2);
  expect(repository.create).toHaveBeenCalledWith(id, {
    name: "Synthetic",
    email: "synthetic@test.invalid",
    authUserId: id,
  });
  expect(JSON.stringify(value)).not.toContain(input.password);
  expect(gateway.createConfirmedUser).toHaveBeenCalledWith(
    "synthetic@test.invalid",
    input.password,
  );
});
test("duplicate email and invalid password do not touch privileged Auth", async () => {
  const { repository, gateway } = harness();
  repository.emailExists = async () => true;
  await expect(
    createAdminAccount(repository, gateway, actor, input),
  ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  await expect(
    createAdminAccount(repository, gateway, actor, {
      ...input,
      password: "short",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(gateway.createConfirmedUser).not.toHaveBeenCalled();
});
test("failed fresh authorization after Auth compensates only its new UUID", async () => {
  const { repository, gateway } = harness();
  let calls = 0;
  repository.authorize = async () => {
    if (++calls === 2) throw new AdminAccountError("FORBIDDEN", "Denied");
  };
  await expect(
    createAdminAccount(repository, gateway, actor, input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(gateway.removeCreatedUser).toHaveBeenCalledWith(id);
  expect(repository.create).not.toHaveBeenCalled();
});
test("provider failure retains durable pending and never completes/reactivates", async () => {
  const { repository, gateway } = harness();
  gateway.deleteUser = async () => {
    throw new Error("secret provider detail");
  };
  await expect(
    mutateAdminAccount(
      repository,
      gateway,
      actor,
      id,
      "delete",
      account.revision,
    ),
  ).rejects.toMatchObject({ code: "DELETION_PENDING" });
  expect(repository.completeDeletion).not.toHaveBeenCalled();
  expect(repository.setActive).not.toHaveBeenCalled();
});
test("HTTP rejects client actor/role/email edits, malformed/duplicate bodies, oversized body and cross-origin", async () => {
  for (const [operation, body] of [
    ["create", { ...input, actorId: id }],
    [
      "name",
      { name: "New", revision: account.revision, email: "other@test.invalid" },
    ],
    ["name", { name: "New", revision: account.revision, roles: ["ADMIN"] }],
  ] as const) {
    const { repository, gateway } = harness();
    const result = await handleAdminAccountPost({
      repository,
      gateway,
      actor,
      siteUrl: new URL("http://localhost:4500"),
      operation,
      id,
      request: new Request("http://localhost:4500/app/admins", {
        method: "POST",
        headers: {
          Origin: "http://localhost:4500",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    });
    expect(result.status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.rename).not.toHaveBeenCalled();
  }
  for (const [origin, body, mime, status] of [
    ["http://evil.invalid", "{}", "application/json", 403],
    ["http://localhost:4500", "x".repeat(8200), "application/json", 413],
    [
      "http://localhost:4500",
      "name=A&name=B&revision=x",
      "application/x-www-form-urlencoded",
      400,
    ],
  ] as const) {
    const { repository, gateway } = harness();
    const result = await handleAdminAccountPost({
      repository,
      gateway,
      actor,
      siteUrl: new URL("http://localhost:4500"),
      operation: "name",
      id,
      request: new Request("http://localhost:4500/app/admins", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": mime },
        body,
      }),
    });
    expect(result.status).toBe(status);
    expect(
      adminAccountJson(result.payload, result.status).headers.get(
        "Cache-Control",
      ),
    ).toBe("private, no-store");
  }
});
test("gateway accepts only explicit user_not_found, not generic 404 or provider errors", async () => {
  for (const code of ["user_not_found", "unexpected_failure", "not_found"]) {
    const client = createClient("http://127.0.0.1:4000", "synthetic", {
      global: {
        fetch: Object.assign(
          async () =>
            new Response(
              JSON.stringify({ code, message: "Synthetic provider error" }),
              {
                status: 404,
                headers: {
                  "Content-Type": "application/json",
                  "X-Supabase-Api-Version": "2024-01-01",
                },
              },
            ),
          { preconnect: fetch.preconnect },
        ),
      },
    });
    const promise = adminCredentialGateway(client).deleteUser(id);
    if (code === "user_not_found") await promise;
    else await expect(promise).rejects.toThrow("Auth deletion unavailable");
  }
});
