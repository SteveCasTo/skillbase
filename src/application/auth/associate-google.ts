import type {
  AccountIdentity,
  VerifiedAuthSession,
} from "@/domain/auth/identity";
import {
  requireApprovedProviders,
  requireMatchingAccount,
} from "@/domain/auth/identity";
import type { InternalUser } from "@/domain/auth/types";

export interface GoogleLinkProof {
  readonly authUserId: string;
  readonly sessionId: string;
  readonly nonce: string;
  readonly flowId: string;
  readonly existingGoogleIdentityIds: readonly string[];
}
export interface GoogleAssociationRepository {
  consumeGoogleLinkRequest(
    nonce: string,
    internalUserId: string,
    sessionId: string,
  ): Promise<boolean>;
  approveGoogleIdentity(authUserId: string, identityId: string): Promise<void>;
}
export interface GoogleAssociationGateway {
  exchangeCode(code: string): Promise<boolean>;
  getExchangedIdentity(): Promise<{
    identity: AccountIdentity;
    session: VerifiedAuthSession;
  } | null>;
  unlinkRejectedGoogle(): Promise<void>;
  restoreOriginalSession(): Promise<boolean>;
}

export function parseGoogleLinkProof(
  value: string | null,
): GoogleLinkProof | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("authUserId" in parsed) ||
      !("sessionId" in parsed) ||
      !("nonce" in parsed) ||
      !("flowId" in parsed) ||
      !("existingGoogleIdentityIds" in parsed)
    )
      return null;
    if (
      typeof parsed.authUserId !== "string" ||
      !parsed.authUserId ||
      parsed.authUserId.length > 64 ||
      typeof parsed.sessionId !== "string" ||
      !parsed.sessionId ||
      parsed.sessionId.length > 64 ||
      typeof parsed.nonce !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(parsed.nonce)
    )
      return null;
    if (
      typeof parsed.flowId !== "string" ||
      !/^[A-Za-z0-9_-]{8,64}$/u.test(parsed.flowId)
    )
      return null;
    if (
      !Array.isArray(parsed.existingGoogleIdentityIds) ||
      parsed.existingGoogleIdentityIds.length > 4 ||
      parsed.existingGoogleIdentityIds.some(
        (id: unknown) => typeof id !== "string" || !id || id.length > 128,
      )
    )
      return null;
    return {
      authUserId: parsed.authUserId,
      sessionId: parsed.sessionId,
      nonce: parsed.nonce,
      flowId: parsed.flowId,
      existingGoogleIdentityIds: parsed.existingGoogleIdentityIds as string[],
    };
  } catch {
    return null;
  }
}

export async function completeGoogleAssociation(
  actor: InternalUser,
  originalIdentity: AccountIdentity,
  originalSession: VerifiedAuthSession,
  proof: GoogleLinkProof,
  code: string,
  repository: GoogleAssociationRepository,
  gateway: GoogleAssociationGateway,
): Promise<{ success: boolean; originalSessionRestored: boolean }> {
  let exchanged = false;
  let rejectedOwnGoogle = false;
  try {
    requireApprovedProviders(actor, originalIdentity, originalSession);
    if (
      proof.authUserId !== actor.authUserId ||
      proof.sessionId !== originalSession.id ||
      !code ||
      !(await repository.consumeGoogleLinkRequest(
        proof.nonce,
        actor.id,
        originalSession.id,
      ))
    )
      return { success: false, originalSessionRestored: true };
    if (!(await gateway.exchangeCode(code)))
      return { success: false, originalSessionRestored: true };
    exchanged = true;
    const linked = await gateway.getExchangedIdentity();
    if (!linked || linked.identity.id !== actor.authUserId)
      throw new Error("Link identity does not match");
    rejectedOwnGoogle = true;
    requireMatchingAccount(actor, linked.identity);
    if (linked.session.method !== "OAUTH")
      throw new Error("Google authentication is required");
    const google = linked.identity.identities.filter(
      (entry) => entry.provider === "google",
    );
    if (google.length !== 1) throw new Error("Google identity is ambiguous");
    requireApprovedProviders(
      { ...actor, approvedGoogleIdentityId: google[0]!.id },
      linked.identity,
      linked.session,
    );
    await repository.approveGoogleIdentity(actor.authUserId!, google[0]!.id);
    return { success: true, originalSessionRestored: false };
  } catch {
    if (!exchanged) return { success: false, originalSessionRestored: true };
    if (rejectedOwnGoogle) await gateway.unlinkRejectedGoogle().catch(() => {});
    const restored = await gateway.restoreOriginalSession().catch(() => false);
    return { success: false, originalSessionRestored: restored };
  }
}
