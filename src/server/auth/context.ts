import type { User } from "@supabase/supabase-js";

import { resolveActiveUser } from "@/application/auth/authorize";
import {
  requireApprovedProviders,
  type VerifiedAuthSession,
} from "@/domain/auth/identity";
import { accountIdentity } from "./identity";
import type { AuthUserRepository } from "@/application/auth/user-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import { traceSlowOperation } from "@/server/observability/slow-operation";

import type { RequestSupabaseClient } from "./supabase";
import { loadVerifiedAuthSession } from "./session";

export interface RequestAuthContext {
  readonly authUser: User | null;
  readonly internalUser: InternalUser | null;
  readonly error: AuthorizationError | null;
  readonly session: VerifiedAuthSession | null;
}

export async function loadRequestAuthContext(
  supabase: RequestSupabaseClient,
  repository: AuthUserRepository,
): Promise<RequestAuthContext> {
  const { data, error } = await traceSlowOperation("auth.getUser", () =>
    supabase.auth.getUser(),
  );
  if (error || !data.user)
    return { authUser: null, internalUser: null, error: null, session: null };
  try {
    const internalUser = await traceSlowOperation(
      "auth.resolveActiveUser",
      () => resolveActiveUser(repository, data.user.id),
    );
    const session = await loadVerifiedAuthSession(supabase, data.user.id);
    requireApprovedProviders(internalUser, accountIdentity(data.user), session);
    return { authUser: data.user, internalUser, error: null, session };
  } catch (caught) {
    if (caught instanceof AuthorizationError)
      return {
        authUser: data.user,
        internalUser: null,
        error: caught,
        session: null,
      };
    throw caught;
  }
}

export function requireRequestSupabaseClient(
  locals: App.Locals,
): RequestSupabaseClient {
  if (!locals.supabase)
    throw new Error("This route requires an initialized Auth client");
  return locals.supabase;
}

export function requireInternalUser(locals: App.Locals): InternalUser {
  if (!locals.internalUser)
    throw new Error("This route requires an authorized internal user");
  return locals.internalUser;
}
