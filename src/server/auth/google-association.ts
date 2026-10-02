import {
  completeGoogleAssociation,
  parseGoogleLinkProof,
} from "@/application/auth/associate-google";
import { loadRequestAuthContext } from "./context";
import { accountIdentity } from "./identity";
import { loadVerifiedAuthSession } from "./session";
import { readAuthProof } from "./security";
import type { RequestSupabaseClient } from "./supabase";
import type { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import type { User } from "@supabase/supabase-js";

export async function finishGoogleAssociation(
  supabase: RequestSupabaseClient,
  repository: DrizzleAuthUserRepository,
  cookie: string,
  code: string | null,
): Promise<string> {
  const original = await loadRequestAuthContext(supabase, repository);
  const failure = original.internalUser
    ? "/app/perfil?error=link"
    : "/login?error=link";
  try {
    const proof = parseGoogleLinkProof(readAuthProof(cookie));
    if (
      !original.internalUser ||
      !original.authUser ||
      !original.session ||
      !proof
    )
      return failure;
    const { data } = await supabase.auth.getSession();
    const saved = data.session;
    if (!saved) return failure;
    let exchangedUser: User | null = null;
    const result = await completeGoogleAssociation(
      original.internalUser,
      accountIdentity(original.authUser),
      original.session,
      proof,
      code ?? "",
      repository,
      {
        async exchangeCode(value) {
          const { error } = await supabase.auth.exchangeCodeForSession(value, {
            flowId: proof.flowId,
          });
          return !error;
        },
        async getExchangedIdentity() {
          const { data, error } = await supabase.auth.getUser();
          if (error || !data.user) return null;
          exchangedUser = data.user;
          return {
            identity: accountIdentity(data.user),
            session: await loadVerifiedAuthSession(supabase, data.user.id),
          };
        },
        async unlinkRejectedGoogle() {
          if (exchangedUser?.id !== original.authUser!.id) return;
          const google = exchangedUser.identities?.find(
            (entry) =>
              entry.provider === "google" &&
              entry.id !== original.internalUser!.approvedGoogleIdentityId &&
              !proof.existingGoogleIdentityIds.includes(entry.id),
          );
          if (google) await supabase.auth.unlinkIdentity(google);
        },
        async restoreOriginalSession() {
          // Revoke only the newly exchanged session, not the still-valid owner
          // session saved before exchange. No credentials leave this adapter.
          await supabase.auth.signOut({ scope: "local" });
          const { error } = await supabase.auth.setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
          });
          if (error) return false;
          const restored = await loadRequestAuthContext(supabase, repository);
          return (
            restored.internalUser?.id === original.internalUser!.id &&
            restored.session?.id === original.session!.id
          );
        },
      },
    );
    if (result.success) return "/app/perfil?status=linked";
    return result.originalSessionRestored ? failure : "/login?error=link";
  } catch {
    return failure;
  }
}
