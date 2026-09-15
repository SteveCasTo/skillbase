import type { User } from "@supabase/supabase-js";

import { resolveActiveUser } from "@/application/auth/authorize";
import type { AuthUserRepository } from "@/application/auth/user-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";

import type { RequestSupabaseClient } from "./supabase";

export interface RequestAuthContext {
  readonly authUser: User | null;
  readonly internalUser: InternalUser | null;
  readonly error: AuthorizationError | null;
}

export async function loadRequestAuthContext(
  supabase: RequestSupabaseClient,
  repository: AuthUserRepository,
): Promise<RequestAuthContext> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    return { authUser: null, internalUser: null, error: null };
  try {
    const internalUser = await resolveActiveUser(repository, data.user.id);
    return { authUser: data.user, internalUser, error: null };
  } catch (caught) {
    if (caught instanceof AuthorizationError)
      return { authUser: data.user, internalUser: null, error: caught };
    throw caught;
  }
}
