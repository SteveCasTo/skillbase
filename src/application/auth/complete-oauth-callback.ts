import { AuthorizationError } from "@/domain/auth/errors";

import { linkAuthenticatedInvitation } from "./link-invitation";
import type { AuthUserRepository } from "./user-repository";

export interface OAuthIdentity {
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly providers: readonly string[];
}

export interface OAuthCallbackGateway {
  exchangeCode(code: string): Promise<boolean>;
  getIdentity(): Promise<OAuthIdentity | null>;
  signOutCurrent(): Promise<void>;
}

export type OAuthCallbackResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: string };

export async function completeOAuthCallback(
  gateway: OAuthCallbackGateway,
  repository: AuthUserRepository,
  code: string,
): Promise<OAuthCallbackResult> {
  if (!(await gateway.exchangeCode(code)))
    return { success: false, reason: "oauth_callback" };

  const identity = await gateway.getIdentity();
  if (!identity) {
    await gateway.signOutCurrent();
    return { success: false, reason: "invalid_identity" };
  }
  if (!identity.providers.includes("google")) {
    await gateway.signOutCurrent();
    return { success: false, reason: "invalid_provider" };
  }

  try {
    await linkAuthenticatedInvitation(repository, {
      authUserId: identity.authUserId,
      email: identity.email,
      emailVerified: identity.emailVerified,
      provider: "google",
    });
    return { success: true };
  } catch (error) {
    await gateway.signOutCurrent();
    return {
      success: false,
      reason:
        error instanceof AuthorizationError
          ? error.code.toLowerCase()
          : "provisioning_error",
    };
  }
}
