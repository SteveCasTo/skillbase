import { afterEach, expect, test } from "bun:test";
import {
  requireApprovedProviders,
  requireMatchingAccount,
  requirePassword,
  sessionFromVerifiedClaims,
  type AccountIdentity,
} from "@/domain/auth/identity";
import type { InternalUser } from "@/domain/auth/types";
import { changeAccountPassword } from "@/application/auth/change-password";
import {
  provisionPasswordInstructor,
  type PasswordProvisionRepository,
} from "@/application/auth/provision-password-user";
import {
  readAuthForm,
  readAuthProof,
  signAuthProof,
  sessionProofValue,
} from "@/server/auth/security";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
const user: InternalUser = {
  id: "internal",
  authUserId: "auth",
  email: "user@example.test",
  name: "User",
  status: "ACTIVE",
  roles: ["INSTRUCTOR"],
};
const emailIdentity: AccountIdentity = {
  id: "auth",
  email: "USER@example.test",
  verified: true,
  identities: [
    { id: "email", provider: "email", email: user.email, verified: true },
  ],
};
const google = {
  id: "google",
  provider: "google",
  email: user.email,
  verified: true,
};
const passwordSession = { id: "session", method: "PASSWORD" } as const;
const googleSession = { id: "oauth-session", method: "OAUTH" } as const;
const originalSecret = process.env.AUTH_RATE_LIMIT_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
  else process.env.AUTH_RATE_LIMIT_SECRET = originalSecret;
});

test("verified email and Google resolve the same internal identity, never email ownership", () => {
  expect(() =>
    requireApprovedProviders(user, emailIdentity, passwordSession),
  ).not.toThrow();
  expect(() =>
    requireApprovedProviders(
      { ...user, authPrimaryProvider: "GOOGLE" },
      { ...emailIdentity, identities: [google] },
      googleSession,
    ),
  ).not.toThrow();
  for (const identity of [
    { ...emailIdentity, id: "other" },
    { ...emailIdentity, email: "other@example.test" },
    { ...emailIdentity, verified: false },
  ])
    expect(() => requireMatchingAccount(user, identity)).toThrow();
  expect(() =>
    requireApprovedProviders(
      { ...user, status: "DISABLED" },
      emailIdentity,
      passwordSession,
    ),
  ).toThrow();
  expect(() =>
    requireApprovedProviders(
      { ...user, roles: [] },
      emailIdentity,
      passwordSession,
    ),
  ).toThrow();
});
test("automatic Google attachment denies only OAuth until explicit approval and never locks out password ownership", () => {
  const mixed = {
    ...emailIdentity,
    identities: [...emailIdentity.identities, google],
  };
  expect(() => requireApprovedProviders(user, mixed, googleSession)).toThrow(
    "Explicit Google association",
  );
  expect(() =>
    requireApprovedProviders(
      { ...user, approvedGoogleIdentityId: "google" },
      mixed,
      googleSession,
    ),
  ).not.toThrow();
  expect(() =>
    requireApprovedProviders(user, mixed, passwordSession),
  ).not.toThrow();
  expect(() =>
    requireApprovedProviders(
      { ...user, authPrimaryProvider: "EMAIL" },
      { ...mixed, identities: [google] },
      googleSession,
    ),
  ).toThrow("Explicit Google association");
  expect(() =>
    requireApprovedProviders(user, mixed, {
      id: "recovery",
      method: "EMAIL_CONFIRMATION",
    }),
  ).not.toThrow();
  for (const entry of [
    { ...google, email: "different@example.test" },
    { ...google, verified: false },
    { ...google, id: "unapproved" },
  ])
    expect(() =>
      requireApprovedProviders(
        { ...user, approvedGoogleIdentityId: "google" },
        { ...mixed, identities: [...emailIdentity.identities, entry] },
        googleSession,
      ),
    ).toThrow();
  expect(() =>
    requireApprovedProviders(
      user,
      {
        ...mixed,
        identities: [
          ...emailIdentity.identities,
          { ...google, email: "different@example.test", verified: false },
        ],
      },
      passwordSession,
    ),
  ).not.toThrow();
});

test("trusted AMR classifies the current session, not account providers or user-editable metadata", () => {
  const claims = {
    sub: "auth",
    role: "authenticated",
    is_anonymous: false,
    session_id: "session",
    amr: [{ method: "password", timestamp: 100 }],
    user_metadata: {
      provider: "google",
      amr: [{ method: "oauth", timestamp: 999 }],
    },
    app_metadata: { provider: "google", providers: ["email", "google"] },
  };
  expect(sessionFromVerifiedClaims(claims, "auth")).toEqual(passwordSession);
  expect(
    sessionFromVerifiedClaims(
      {
        ...claims,
        amr: [{ method: "oauth", timestamp: 200 }],
        user_metadata: { provider: "email" },
      },
      "auth",
    ).method,
  ).toBe("OAUTH");
  expect(
    sessionFromVerifiedClaims(
      {
        ...claims,
        amr: [
          ...claims.amr,
          { method: "totp", timestamp: 500 },
          { method: "token_refresh", timestamp: 600 },
        ],
      },
      "auth",
    ).method,
  ).toBe("PASSWORD");
  expect(
    sessionFromVerifiedClaims(
      {
        ...claims,
        amr: [
          { method: "oauth", timestamp: 100 },
          { method: "password", timestamp: 200 },
        ],
      },
      "auth",
    ).method,
  ).toBe("PASSWORD");
  for (const invalid of [
    { ...claims, sub: "other" },
    { ...claims, amr: [] },
    {
      ...claims,
      amr: [
        { method: "password", timestamp: 100 },
        { method: "oauth", timestamp: 100 },
      ],
    },
    { ...claims, amr: [{ method: "sso/saml", timestamp: 100 }] },
    { ...claims, amr: undefined },
    { ...claims, is_anonymous: true },
  ])
    expect(() => sessionFromVerifiedClaims(invalid, "auth")).toThrow();
});
test("password changes require old password verification or a bounded recovery confirmation", async () => {
  let changed = 0;
  const auditActors: string[] = [];
  const gateway = {
    verifyCurrentPassword: async () => false,
    updatePassword: async () => {
      changed++;
      return true;
    },
    recordPasswordChanged: async (actorId: string) => {
      auditActors.push(actorId);
    },
  };
  const input = {
    password: "Synthetic-Password-2026",
    confirmation: "Synthetic-Password-2026",
    currentPassword: "wrong",
    hasRecoveryProof: false,
  };
  await expect(changeAccountPassword(user, input, gateway)).rejects.toThrow(
    "Confirma",
  );
  expect(changed).toBe(0);
  expect(auditActors).toHaveLength(0);
  await expect(
    changeAccountPassword(
      user,
      { ...input, hasRecoveryProof: true },
      {
        ...gateway,
        updatePassword: async () => false,
      },
    ),
  ).rejects.toThrow("No pudimos cambiar");
  expect(auditActors).toHaveLength(0);
  await changeAccountPassword(
    user,
    { ...input, hasRecoveryProof: true },
    gateway,
  );
  expect(changed).toBe(1);
  expect(auditActors).toEqual([user.id]);
  await changeAccountPassword(user, input, {
    ...gateway,
    verifyCurrentPassword: async () => true,
  });
  expect(changed).toBe(2);
  expect(auditActors).toEqual([user.id, user.id]);
  await expect(
    changeAccountPassword(
      { ...user, status: "DISABLED" },
      { ...input, hasRecoveryProof: true },
      gateway,
    ),
  ).rejects.toThrow();
  expect(auditActors).toHaveLength(2);
  const originalConsoleError = console.error;
  const auditFailureLogs: unknown[] = [];
  console.error = (...values: unknown[]) => auditFailureLogs.push(...values);
  try {
    await expect(
      changeAccountPassword(
        user,
        { ...input, hasRecoveryProof: true },
        {
          ...gateway,
          recordPasswordChanged: async () => {
            throw new Error("DB failure");
          },
        },
      ),
    ).resolves.toBeUndefined();
  } finally {
    console.error = originalConsoleError;
  }
  expect(auditFailureLogs).toEqual([
    { event: "PASSWORD_CHANGE_AUDIT_WRITE_FAILED", actorId: user.id },
  ]);
  expect(() => requirePassword("short")).toThrow();
  expect(() => requirePassword(input.password, "different")).toThrow();
});
test("signed confirmation cannot be forged, replayed on another session or used expired", () => {
  process.env.AUTH_RATE_LIMIT_SECRET =
    "unit-only-auth-secret-not-used-in-production";
  const value = sessionProofValue(user.authUserId!, "session-a");
  const token = signAuthProof(value);
  expect(readAuthProof(token)).toBe(value);
  expect(readAuthProof(token + "a")).toBeNull();
  expect(readAuthProof(signAuthProof(value, Date.now() - 1))).toBeNull();
  expect(readAuthProof(token)).not.toBe(
    sessionProofValue(user.authUserId!, "session-b"),
  );
});
test("auth request parsing bounds secrets and rejects ambiguous or cross-origin payloads", async () => {
  const request = (body: string) =>
    new Request("https://app.example/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  expect(
    (await readAuthForm(request("email=a%40example.test&password=value"))).get(
      "password",
    ),
  ).toBe("value");
  await expect(
    readAuthForm(request("password=a&password=b")),
  ).rejects.toThrow();
  await expect(
    readAuthForm(request("password=" + "x".repeat(4097))),
  ).rejects.toThrow();
  expect(
    requestHasExpectedOrigin(request(""), new URL("https://app.example")),
  ).toBe(false);
  expect(
    requestHasExpectedOrigin(
      new Request("https://app.example", {
        headers: { origin: "https://evil.example" },
      }),
      new URL("https://app.example"),
    ),
  ).toBe(false);
});

test("admin provisioning assigns instructor only, compensates DB failure, redacts provider failures", async () => {
  let created = 0;
  let removed = 0;
  const repository: PasswordProvisionRepository = {
    findByAuthUserId: async () => ({ ...user, roles: ["ADMIN"] }),
    preprovision: async () => {
      throw new Error("unused");
    },
    linkVerifiedInvitation: async () => {
      throw new Error("unused");
    },
    createPasswordInstructor: async (input) => ({
      ...user,
      authUserId: input.authUserId,
      email: input.email,
    }),
  };
  const gateway = {
    createConfirmedUser: async () => {
      created++;
      return "new-auth";
    },
    removeCreatedUser: async () => {
      removed++;
    },
  };
  const input = {
    email: " USER@example.test ",
    name: " User ",
    password: "Synthetic-Password-2026",
  };
  const result = await provisionPasswordInstructor(
    repository,
    gateway,
    "admin-auth",
    input,
  );
  expect(result.roles).toEqual(["INSTRUCTOR"]);
  expect(result.email).toBe(user.email);
  await expect(
    provisionPasswordInstructor(
      { ...repository, findByAuthUserId: async () => user },
      gateway,
      "auth",
      input,
    ),
  ).rejects.toThrow();
  expect(created).toBe(1);
  await expect(
    provisionPasswordInstructor(
      {
        ...repository,
        createPasswordInstructor: async () => {
          throw new Error("DB secret");
        },
      },
      gateway,
      "admin-auth",
      input,
    ),
  ).rejects.toThrow("No pudimos crear");
  expect(removed).toBe(1);
  await expect(
    provisionPasswordInstructor(
      repository,
      {
        ...gateway,
        createConfirmedUser: async () => {
          throw new Error(input.password);
        },
      },
      "admin-auth",
      input,
    ),
  ).rejects.toThrow("No pudimos crear");
});
