import { expect, test } from "bun:test";
import { hasRecentGooglePasswordProof } from "@/domain/auth/password-proof";
import {
  changeAccountPassword,
  PasswordChangeError,
} from "@/application/auth/change-password";
import type { InternalUser } from "@/domain/auth/types";
import type { AccountIdentity } from "@/domain/auth/identity";
const now = 1_800_000_000_000;
const user: InternalUser = {
  id: "internal",
  authUserId: "auth",
  email: "synthetic@example.test",
  name: "Synthetic",
  status: "ACTIVE",
  roles: ["ADMIN"],
  authPrimaryProvider: "GOOGLE",
};
const identity: AccountIdentity = {
  id: "auth",
  email: user.email,
  verified: true,
  identities: [
    { id: "google", provider: "google", email: user.email, verified: true },
  ],
};
const claims = {
  sub: "auth",
  session_id: "session",
  role: "authenticated",
  is_anonymous: false,
  amr: [{ method: "oauth", timestamp: now / 1000 - 10 }],
};
test("password creation accepts only recent verified OAuth for the same approved Google actor", () => {
  expect(hasRecentGooglePasswordProof(user, identity, claims, now)).toBe(true);
  for (const invalid of [
    { ...claims, sub: "other" },
    { ...claims, amr: [{ method: "password", timestamp: now / 1000 }] },
    { ...claims, amr: [{ method: "oauth", timestamp: now / 1000 - 300 }] },
    { ...claims, amr: [{ method: "oauth", timestamp: now / 1000 + 1 }] },
    { ...claims, amr: ["oauth"] },
    {
      ...claims,
      amr: [...claims.amr, { method: "password", timestamp: now / 1000 }],
    },
    {
      ...claims,
      amr: [{ method: "recovery", timestamp: now / 1000 }],
      user_metadata: { provider: "google" },
    },
  ])
    expect(hasRecentGooglePasswordProof(user, identity, invalid, now)).toBe(
      false,
    );
  for (const invalid of [
    { ...user, status: "DISABLED" as const },
    { ...user, roles: [] },
    { ...user, authUserId: "other" },
    { ...user, authPrimaryProvider: "EMAIL" as const },
    {
      ...user,
      approvedGoogleIdentityId: "other",
      authPrimaryProvider: "EMAIL" as const,
    },
  ])
    expect(hasRecentGooglePasswordProof(invalid, identity, claims, now)).toBe(
      false,
    );
  for (const invalid of [
    { ...identity, verified: false },
    { ...identity, email: "other@example.test" },
    {
      ...identity,
      identities: [{ ...identity.identities[0]!, verified: false }],
    },
    {
      ...identity,
      identities: [
        ...identity.identities,
        { id: "github", provider: "github", email: user.email, verified: true },
      ],
    },
  ])
    expect(hasRecentGooglePasswordProof(user, invalid, claims, now)).toBe(
      false,
    );
  expect(
    hasRecentGooglePasswordProof(
      {
        ...user,
        authPrimaryProvider: "EMAIL",
        approvedGoogleIdentityId: "google",
      },
      identity,
      claims,
      now,
    ),
  ).toBe(true);
});
test("password errors are actionable, scoped to fields and never update or audit invalid values", async () => {
  let updates = 0;
  const current = "Synthetic-Current-2026";
  const gateway = {
    verifyCurrentPassword: async () => true,
    updatePassword: async () => {
      updates++;
      return true;
    },
    recordPasswordChanged: async () => {},
  };
  const input = {
    currentPassword: current,
    password: current,
    confirmation: current,
    hasRecoveryProof: false,
  };
  await expect(changeAccountPassword(user, input, gateway)).rejects.toThrow(
    "diferente",
  );
  await expect(
    changeAccountPassword(
      user,
      { ...input, confirmation: "mismatch" },
      gateway,
    ),
  ).rejects.toBeInstanceOf(PasswordChangeError);
  await expect(
    changeAccountPassword(
      user,
      { ...input, password: "short", confirmation: "short" },
      gateway,
    ),
  ).rejects.toThrow("12 y 128");
  expect(updates).toBe(0);
  await changeAccountPassword(
    user,
    { ...input, currentPassword: "", hasGoogleProof: true },
    {
      ...gateway,
      verifyCurrentPassword: async () => {
        throw new Error("must not verify absent credential");
      },
    },
  );
  expect(updates).toBe(1);
});
