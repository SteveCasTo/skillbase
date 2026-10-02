import { createClient } from "@supabase/supabase-js";
import type { InstructorCredentialRemoval } from "@/application/instructors/lifecycle";
import { getPublicAuthEnvironment } from "@/server/environment";

export const instructorCredentialRemoval: InstructorCredentialRemoval = {
  async remove(id) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) throw new Error("Credential removal unavailable");
    const client = createClient(getPublicAuthEnvironment().supabaseUrl, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { error } = await client.auth.admin.deleteUser(id);
    // A retry after provider success + DB failure is safe only for an explicit not-found.
    if (error && error.code !== "user_not_found")
      throw new Error("Credential removal failed");
  },
};
