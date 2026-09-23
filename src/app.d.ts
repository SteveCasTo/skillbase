import type { User } from "@supabase/supabase-js";

import type { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import type { RequestSupabaseClient } from "@/server/auth/supabase";

declare global {
  namespace App {
    interface Locals {
      supabase?: RequestSupabaseClient;
      authUser?: User | null;
      internalUser?: InternalUser | null;
      authError?: AuthorizationError | null;
    }
  }
}

export {};
