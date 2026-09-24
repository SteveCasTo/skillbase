import type { AuthRole } from "@/domain/auth/types";

export type PrivateRoutePolicy =
  | { readonly access: "ACTIVE_USER" }
  | { readonly access: "ROLES"; readonly roles: readonly AuthRole[] };

export const PRIVATE_ROUTE_POLICIES = {
  "/app": { access: "ACTIVE_USER" },
  "/app/cursos": { access: "ROLES", roles: ["ADMIN"] },
  "/app/cursos/nuevo": { access: "ROLES", roles: ["ADMIN"] },
  "/app/cursos/imagen": { access: "ROLES", roles: ["ADMIN"] },
  "/app/formatos": { access: "ROLES", roles: ["ADMIN"] },
  "/app/asistencia": { access: "ROLES", roles: ["INSTRUCTOR"] },
} as const satisfies Readonly<Record<string, PrivateRoutePolicy>>;

const COURSE_EDIT_PATH =
  /^\/app\/cursos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/editar$/i;

export function getPrivateRoutePolicy(
  pathname: string,
): PrivateRoutePolicy | null {
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const exact =
    PRIVATE_ROUTE_POLICIES[
      normalizedPath as keyof typeof PRIVATE_ROUTE_POLICIES
    ] ?? null;
  if (exact) return exact;
  return COURSE_EDIT_PATH.test(normalizedPath)
    ? { access: "ROLES", roles: ["ADMIN"] }
    : null;
}

export function isPrivatePath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export type AuthRouteContext = "NONE" | "CLIENT" | "FULL";

export function getAuthRouteContext(pathname: string): AuthRouteContext {
  if (isPrivatePath(pathname) || pathname === "/login") return "FULL";
  if (pathname.startsWith("/auth/")) return "CLIENT";
  return "NONE";
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
