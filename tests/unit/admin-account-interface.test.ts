import { expect, mock, test } from "bun:test";
import type { APIContext } from "astro";
import type { InternalUser } from "@/domain/auth/types";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";
import type {
  AdminAccountRepository,
  AdminCredentialGateway,
} from "@/application/admin-accounts/repository";
import { AdminAccountError } from "@/domain/admin-accounts/rules";
import { adminAccountPage } from "@/server/admin-accounts/page";
import {
  adminAccountStatus,
  adminCreateEligible,
  adminAccountBlockedReason,
  adminAccountActions,
} from "@/components/admin-accounts/presentation";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { navigationSkeletonVariant } from "@/components/private-nav/navigation-skeleton";
import { requireRoles } from "@/application/auth/authorize";

const actorId = "f2000000-0000-4000-8000-000000000001";
const targetId = "f2000000-0000-4000-8000-000000000002";
const actor: InternalUser = {
  id: actorId,
  authUserId: actorId,
  name: "QA Admin",
  email: "actor@test.invalid",
  status: "ACTIVE",
  roles: ["ADMIN"],
};
const account: AdminAccountDto = {
  id: targetId,
  name: "QA Target",
  email: "target@test.invalid",
  status: "ACTIVE",
  revision: "2026-10-07T12:00:00.000Z",
  exclusiveAdmin: true,
  hasActivity: false,
  deletionPending: false,
  action: "delete",
  lifecycleBlockedReason: null,
};
const siteUrl = new URL("http://localhost:4578");
test("last-active lifecycle disability comes from the server projection, not visible account counts", () => {
  expect(
    adminAccountBlockedReason({ lifecycleBlockedReason: null }),
  ).toBeNull();
  expect(
    adminAccountBlockedReason({ lifecycleBlockedReason: "last-active-admin" }),
  ).toBe("Debe quedar al menos un administrador activo.");
  for (const action of ["delete", "deactivate"] as const) {
    const blocked = {
      ...account,
      action,
      lifecycleBlockedReason: "last-active-admin" as const,
    };
    expect(adminAccountActions[blocked.action].label).toBeTruthy();
    expect(adminAccountBlockedReason(blocked)).not.toBeNull();
  }
});
test("explicit ADMIN route registration remains fail-closed and classifies structural loads", () => {
  for (const [path, variant] of [
    ["/app/administradores", "list"],
    ["/app/administradores/nuevo", "form"],
    [`/app/administradores/${targetId}`, "detail"],
  ] as const) {
    const policy = getPrivateRoutePolicy(path);
    expect(policy).toEqual({ access: "ROLES", roles: ["ADMIN"] });
    expect(getPrivateRoutePolicy(`${path}/`)).toEqual(policy);
    expect(navigationSkeletonVariant(path)).toBe(variant);
    if (policy?.access === "ROLES") {
      expect(() =>
        requireRoles({ ...actor, roles: ["INSTRUCTOR"] }, policy.roles),
      ).toThrow();
      expect(() =>
        requireRoles(
          { ...actor, roles: ["ADMIN", "INSTRUCTOR"] },
          policy.roles,
        ),
      ).not.toThrow();
    }
  }
  for (const path of [
    "/app/administradores/no-uuid",
    "/app/administradores/nuevo/extra",
    `/app/administradores/${targetId}/password`,
    "/app/administradores-exportar",
    "/app/admin",
    "/app/future",
  ])
    expect(getPrivateRoutePolicy(path)).toBeNull();
  const group = "f2000000-0000-4000-8000-000000000003";
  for (const scope of ["cursos", "mis-cursos"]) {
    const base = `/app/${scope}/${targetId}/grupos/${group}/cierre`;
    for (const suffix of [
      "",
      "/1",
      "/1/planilla.pdf",
      "/1/planilla.csv",
      "/1/informe.pdf",
    ])
      expect(getPrivateRoutePolicy(base + suffix)).toEqual({
        access: "ROLES",
        roles: scope === "cursos" ? ["ADMIN"] : ["INSTRUCTOR"],
      });
    for (const suffix of ["/0", "/1/secret", "/1/planilla.pdf/extra"])
      expect(getPrivateRoutePolicy(base + suffix)).toBeNull();
  }
});
function harness(
  body?: Record<string, string>,
  operation?: string,
  json = false,
) {
  const url = new URL(
    `/app/administradores/${operation ? targetId : "nuevo"}`,
    siteUrl,
  );
  if (operation) url.searchParams.set("operation", operation);
  const context = {
    url,
    request: new Request(
      url,
      body
        ? {
            method: "POST",
            headers: {
              Origin: siteUrl.origin,
              ...(json ? { Accept: "application/json" } : {}),
            },
            body: new URLSearchParams(body),
          }
        : {},
    ),
    locals: { internalUser: actor },
    response: { status: 200, headers: new Headers() },
    redirect: ((destination: string, status = 302) =>
      new Response(null, {
        status,
        headers: { Location: destination },
      })) as APIContext["redirect"],
  };
  const repository: AdminAccountRepository = {
    authorize: mock(async () => {}),
    list: mock(async () => [account]),
    get: mock(async () => account),
    emailExists: mock(async () => false),
    create: mock(async () => account),
    rename: mock(async () => ({ account, actorActive: true, deleted: false })),
    setActive: mock(async () => ({
      account,
      actorActive: true,
      deleted: false,
    })),
    beginDeletion: mock(async () => ({
      authUserId: targetId,
      actorActive: true,
      completed: false,
    })),
    completeDeletion: mock(async () => ({
      account: null,
      actorActive: true,
      deleted: true,
    })),
  };
  const gateway: AdminCredentialGateway = {
    createConfirmedUser: mock(async () => targetId),
    removeCreatedUser: mock(async () => {}),
    deleteUser: mock(async () => {}),
  };
  const dependencies = { repository, gateway: () => gateway, siteUrl };
  return { context, repository, gateway, dependencies };
}

test("creation eligibility and state copy cover invalid, disabled and pending inputs", () => {
  const valid = {
    name: " María ",
    email: "maria@test.invalid",
    password: "Synthetic-Only-Password",
  };
  expect(adminCreateEligible(valid)).toBe(true);
  for (const invalid of [
    { ...valid, name: "   " },
    { ...valid, email: "invalid" },
    { ...valid, password: "short" },
  ])
    expect(adminCreateEligible(invalid)).toBe(false);
  expect(adminAccountStatus(account)).toBe("Cuenta activa");
  expect(adminAccountStatus({ ...account, status: "DISABLED" })).toBe(
    "Cuenta desactivada",
  );
  expect(adminAccountStatus({ ...account, deletionPending: true })).toContain(
    "acceso bloqueado",
  );
});
test("SSR creation redirects to the new UUID without password in output or destination", async () => {
  const f = harness({
    name: "QA Target",
    email: account.email,
    password: "Synthetic-Only-Password",
  });
  const result = await adminAccountPage(f.context, undefined, f.dependencies);
  expect(result.response?.status).toBe(303);
  expect(result.response?.headers.get("Location")).toBe(
    `/app/administradores/${targetId}?success=saved`,
  );
  expect(result.response?.headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
  expect(JSON.stringify(result)).not.toContain("Synthetic-Only-Password");
});
test("SSR field failure preserves name/email only and never repopulates password", async () => {
  const f = harness({
    name: "QA Target",
    email: "not-email",
    password: "Synthetic-Only-Password",
  });
  const result = await adminAccountPage(f.context, undefined, f.dependencies);
  expect(f.context.response.status).toBe(422);
  expect(result.values).toEqual({ name: "QA Target", email: "not-email" });
  expect(result.issues.email).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain("Synthetic-Only-Password");
  expect(f.gateway.createConfirmedUser).not.toHaveBeenCalled();
});
test("JSON rename uses route target and server actor; privileged credentials are lazy", async () => {
  const f = harness(
    { name: "Updated", revision: account.revision },
    "name",
    true,
  );
  f.dependencies.gateway = () => {
    throw new Error("No privileged Auth key");
  };
  const result = await adminAccountPage(f.context, targetId, f.dependencies);
  expect(result.response?.status).toBe(200);
  expect(f.repository.rename).toHaveBeenCalledWith(
    actorId,
    targetId,
    "Updated",
    new Date(account.revision),
  );
  expect((await result.response!.json()).value.account.id).toBe(targetId);
});
test("spoofed actor or unsupported operation never mutates a target", async () => {
  for (const operation of ["name", "arbitrary"]) {
    const f = harness(
      { name: "Updated", revision: account.revision, actorId: targetId },
      operation,
      true,
    );
    const result = await adminAccountPage(f.context, targetId, f.dependencies);
    expect(result.response?.status).toBe(422);
    expect(f.repository.rename).not.toHaveBeenCalled();
  }
});
test("invalid route UUID fails contextually without repository lookup", async () => {
  const f = harness();
  const result = await adminAccountPage(
    f.context,
    "invalid-id",
    f.dependencies,
  );
  expect(result.code).toBe("NOT_FOUND");
  expect(f.context.response.status).toBe(404);
  expect(f.repository.get).not.toHaveBeenCalled();
});
test("SSR optimistic conflict retains draft while refreshing account/revision", async () => {
  const f = harness({ name: "Draft", revision: account.revision }, "name");
  f.repository.rename = async () => {
    throw new AdminAccountError("CONCURRENT_UPDATE", "Recarga la cuenta.");
  };
  const result = await adminAccountPage(f.context, targetId, f.dependencies);
  expect(f.context.response.status).toBe(409);
  expect(result.values.name).toBe("Draft");
  expect(result.submittedName).toBe(true);
  expect(result.account?.name).toBe(account.name);
});
test("last-active guard stays authoritative and delivers recoverable JSON conflict", async () => {
  const f = harness({ revision: account.revision }, "deactivate", true);
  f.repository.setActive = async () => {
    throw new AdminAccountError(
      "LAST_ACTIVE_ADMIN",
      "Debe quedar un administrador activo.",
    );
  };
  const result = await adminAccountPage(f.context, targetId, f.dependencies);
  expect(result.response?.status).toBe(409);
  expect((await result.response!.json()).code).toBe("LAST_ACTIVE_ADMIN");
});
test("self-lifecycle actorActive=false redirects HTML and JSON to login", async () => {
  for (const json of [false, true]) {
    const f = harness({ revision: account.revision }, "deactivate", json);
    f.repository.setActive = async () => ({
      account: { ...account, status: "DISABLED" },
      actorActive: false,
      deleted: false,
    });
    const result = await adminAccountPage(f.context, targetId, f.dependencies);
    expect(result.response?.status).toBe(303);
    expect(result.response?.headers.get("Location")).toBe("/login");
  }
});
test("failed durable self-delete redirects after fresh actor authorization fails", async () => {
  const f = harness({ revision: account.revision }, "delete", true);
  let blocked = false;
  f.gateway.deleteUser = async () => {
    throw new Error("Synthetic Auth unavailable");
  };
  f.repository.authorize = async () => {
    if (blocked) throw new AdminAccountError("FORBIDDEN", "Blocked");
  };
  f.repository.beginDeletion = async () => {
    blocked = true;
    return { authUserId: targetId, completed: false, actorActive: false };
  };
  const result = await adminAccountPage(f.context, actorId, f.dependencies);
  expect(result.response?.headers.get("Location")).toBe("/login");
  expect(f.repository.completeDeletion).not.toHaveBeenCalled();
});
test("other-account pending deletion refreshes blocked DTO for SSR retry", async () => {
  const f = harness({ revision: account.revision }, "delete");
  f.gateway.deleteUser = async () => {
    throw new Error("Provider detail");
  };
  let reads = 0;
  f.repository.get = async () =>
    ++reads === 1
      ? account
      : {
          ...account,
          status: "DISABLED",
          deletionPending: true,
          action: "retry-delete",
        };
  const result = await adminAccountPage(f.context, targetId, f.dependencies);
  expect(f.context.response.status).toBe(503);
  expect(result.account?.action).toBe("retry-delete");
  expect(result.error).not.toContain("Provider detail");
});
