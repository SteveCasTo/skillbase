import type { APIRoute } from "astro";

import { requireInternalUser } from "@/server/auth/context";
import { privateEntryPath } from "@/server/auth/private-entry";

export const GET: APIRoute = ({ locals, redirect }) => {
  const user = requireInternalUser(locals);
  return redirect(
    privateEntryPath(user) ?? "/unauthorized?reason=forbidden",
    303,
  );
};
