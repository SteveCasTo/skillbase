import { expect, test } from "bun:test";
import {
  completeGoogleAssociation,
  parseGoogleLinkProof,
  type GoogleAssociationGateway,
} from "@/application/auth/associate-google";
import type {
  AccountIdentity,
  VerifiedAuthSession,
} from "@/domain/auth/identity";
import type { InternalUser } from "@/domain/auth/types";
const actor: InternalUser = {
  id: "internal",
  authUserId: "auth",
  email: "owner@example.test",
  name: "Owner",
  roles: ["INSTRUCTOR"],
  status: "ACTIVE",
};
const original: AccountIdentity = {
  id: "auth",
  email: actor.email,
  verified: true,
  identities: [
    { id: "email", provider: "email", email: actor.email, verified: true },
  ],
};
const session: VerifiedAuthSession = {
  id: "password-session",
  method: "PASSWORD",
};
const google = {
  id: "google",
  provider: "google",
  email: "OWNER@example.test",
  verified: true,
};
const proof = {
  authUserId: "auth",
  sessionId: session.id,
  nonce: "10000000-0000-4000-8000-000000000001",
  flowId: "isolatedFixtureFlow",
  existingGoogleIdentityIds: [],
};
function fixture(
  linked: AccountIdentity = {
    ...original,
    identities: [...original.identities, google],
  },
) {
  const calls = { exchange: 0, approve: 0, unlink: 0, restore: 0 };
  let consumed = false;
  const repository = {
    consumeGoogleLinkRequest: async () => {
      if (consumed) return false;
      consumed = true;
      return true;
    },
    approveGoogleIdentity: async () => {
      calls.approve++;
    },
  };
  const gateway: GoogleAssociationGateway = {
    exchangeCode: async () => {
      calls.exchange++;
      return true;
    },
    getExchangedIdentity: async () => ({
      identity: linked,
      session: { id: "new-oauth", method: "OAUTH" },
    }),
    unlinkRejectedGoogle: async () => {
      calls.unlink++;
    },
    restoreOriginalSession: async () => {
      calls.restore++;
      return true;
    },
  };
  return { calls, repository, gateway };
}
test("explicit same-account verified Google association uses the initiating session and single-use nonce", async () => {
  const f = fixture();
  expect(
    await completeGoogleAssociation(
      actor,
      original,
      session,
      proof,
      "code",
      f.repository,
      f.gateway,
    ),
  ).toEqual({ success: true, originalSessionRestored: false });
  expect(f.calls).toEqual({ exchange: 1, approve: 1, unlink: 0, restore: 0 });
  expect(
    await completeGoogleAssociation(
      actor,
      original,
      session,
      proof,
      "code",
      f.repository,
      f.gateway,
    ),
  ).toEqual({ success: false, originalSessionRestored: true });
  expect(f.calls.exchange).toBe(1);
});
test("stale/switched sessions, mismatched actors and missing/expired nonces never exchange or approve", async () => {
  const f = fixture();
  for (const candidate of [
    { ...proof, authUserId: "other" },
    { ...proof, sessionId: "new-password-session" },
  ])
    expect(
      (
        await completeGoogleAssociation(
          actor,
          original,
          session,
          candidate,
          "code",
          f.repository,
          f.gateway,
        )
      ).success,
    ).toBe(false);
  expect(
    (
      await completeGoogleAssociation(
        actor,
        original,
        session,
        proof,
        "code",
        { ...f.repository, consumeGoogleLinkRequest: async () => false },
        f.gateway,
      )
    ).success,
  ).toBe(false);
  expect(
    (
      await completeGoogleAssociation(
        { ...actor, status: "DISABLED" },
        original,
        session,
        proof,
        "code",
        f.repository,
        f.gateway,
      )
    ).success,
  ).toBe(false);
  expect(f.calls.exchange).toBe(0);
  expect(f.calls.approve).toBe(0);
});
test("wrong Google email or unverified identity fails closed and restores the original owner session", async () => {
  for (const identity of [
    { ...google, email: "other@example.test" },
    { ...google, verified: false },
  ]) {
    const f = fixture({
      ...original,
      identities: [...original.identities, identity],
    });
    expect(
      await completeGoogleAssociation(
        actor,
        original,
        session,
        proof,
        "code",
        f.repository,
        f.gateway,
      ),
    ).toEqual({ success: false, originalSessionRestored: true });
    expect(f.calls.approve).toBe(0);
    expect(f.calls.unlink).toBe(1);
    expect(f.calls.restore).toBe(1);
  }
});
test("another account's callback restores the owner but never unlinks the other account", async () => {
  const f = fixture({ ...original, id: "other-auth", identities: [google] });
  expect(
    (
      await completeGoogleAssociation(
        actor,
        original,
        session,
        proof,
        "code",
        f.repository,
        f.gateway,
      )
    ).success,
  ).toBe(false);
  expect(f.calls).toEqual({ exchange: 1, approve: 0, unlink: 0, restore: 1 });
});
test("a non-OAuth callback cannot approve Google; provider failures contain no secret payload", async () => {
  const f = fixture();
  f.gateway.getExchangedIdentity = async () => ({
    identity: { ...original, identities: [...original.identities, google] },
    session,
  });
  expect(
    (
      await completeGoogleAssociation(
        actor,
        original,
        session,
        proof,
        "code",
        f.repository,
        f.gateway,
      )
    ).success,
  ).toBe(false);
  expect(f.calls.approve).toBe(0);
  const errorFixture = fixture();
  errorFixture.gateway.exchangeCode = async () => {
    throw new Error("provider-secret-password");
  };
  expect(
    await completeGoogleAssociation(
      actor,
      original,
      session,
      proof,
      "code",
      errorFixture.repository,
      errorFixture.gateway,
    ),
  ).toEqual({ success: false, originalSessionRestored: true });
});
test("link proof parsing rejects malformed, missing and oversized actors", () => {
  expect(parseGoogleLinkProof(JSON.stringify(proof))).toEqual(proof);
  for (const value of [
    null,
    "{}",
    "invalid",
    JSON.stringify({ ...proof, nonce: "invalid" }),
    JSON.stringify({ ...proof, authUserId: "x".repeat(65) }),
  ])
    expect(parseGoogleLinkProof(value)).toBeNull();
});
