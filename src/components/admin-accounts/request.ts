import type { AdminAccountHttpPayload } from "@/server/admin-accounts/http";

export async function postAdminAccount(
  endpoint: string,
  body: URLSearchParams,
): Promise<AdminAccountHttpPayload> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
  // Self-lifecycle returns a server redirect, including the durable-pending failure case.
  if (response.redirected) {
    const destination = new URL(response.url);
    if (
      destination.origin === window.location.origin &&
      destination.pathname === "/login"
    ) {
      window.location.assign("/login");
      throw new Error("El acceso a esta cuenta se ha cerrado.");
    }
  }
  const payload: AdminAccountHttpPayload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.ok !== "boolean"
  )
    throw new Error(
      "No pudimos confirmar la operación. Recarga para comprobar el estado.",
    );
  return payload;
}
