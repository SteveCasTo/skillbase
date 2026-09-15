import type { AuthRole } from "@/domain/auth/types";

export type PrivateRoutePolicy =
  | { readonly access: "ACTIVE_USER" }
  | { readonly access: "ROLES"; readonly roles: readonly AuthRole[] };

export const PRIVATE_ROUTE_POLICIES = {
  "/app": { access: "ACTIVE_USER" },
  "/app/cursos": { access: "ROLES", roles: ["ADMIN"] },
  "/app/asistencia": { access: "ROLES", roles: ["INSTRUCTOR"] },
} as const satisfies Readonly<Record<string, PrivateRoutePolicy>>;

export function getPrivateRoutePolicy(
  pathname: string,
): PrivateRoutePolicy | null {
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return (
    PRIVATE_ROUTE_POLICIES[
      normalizedPath as keyof typeof PRIVATE_ROUTE_POLICIES
    ] ?? null
  );
}

export function isPrivatePath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function isSessionDependentPath(pathname: string): boolean {
  return (
    isPrivatePath(pathname) ||
    pathname === "/login" ||
    pathname === "/unauthorized" ||
    pathname.startsWith("/auth/")
  );
}

export function applyPrivateNoStore(response: Response): void {
  response.headers.set("Cache-Control", "private, no-store");
}

export function privateNoStoreResponse(
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  const response = new Response(body, init);
  applyPrivateNoStore(response);
  return response;
}
