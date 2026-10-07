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
  "/app/formatos/nuevo": { access: "ROLES", roles: ["ADMIN"] },
  "/app/interesados": { access: "ROLES", roles: ["ADMIN"] },
  "/app/preinscripciones": { access: "ROLES", roles: ["ADMIN"] },
  "/app/preinscripciones/nueva": { access: "ROLES", roles: ["ADMIN"] },
  "/app/preinscripciones/buscar": { access: "ROLES", roles: ["ADMIN"] },
  "/app/preinscripciones/exportar": { access: "ROLES", roles: ["ADMIN"] },
  "/app/configuracion": { access: "ROLES", roles: ["ADMIN"] },
  "/app/configuracion/asistencia": { access: "ROLES", roles: ["ADMIN"] },
  "/app/perfil": { access: "ACTIVE_USER" },
  "/app/perfil/contrasena": { access: "ACTIVE_USER" },
  "/app/instructores": { access: "ROLES", roles: ["ADMIN"] },
  "/app/instructores/nuevo": { access: "ROLES", roles: ["ADMIN"] },
  "/app/mis-cursos": { access: "ROLES", roles: ["INSTRUCTOR"] },
} as const satisfies Readonly<Record<string, PrivateRoutePolicy>>;

const COURSE_EDIT_PATH =
  /^\/app\/cursos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/editar$/i;
const COURSE_GROUPS_PATH =
  /^\/app\/cursos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/grupos$/i;
const FORMAT_DETAIL_PATH =
  /^\/app\/formatos\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const INTEREST_DETAIL_PATH =
  /^\/app\/interesados\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (
    /^\/app\/(?:cursos|mis-cursos)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/grupos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\/evaluaciones$/iu.test(
      normalizedPath,
    )
  )
    return {
      access: "ROLES",
      roles: normalizedPath.startsWith("/app/mis-cursos/")
        ? ["INSTRUCTOR"]
        : ["ADMIN"],
    };
  if (
    /^\/app\/(?:cursos|mis-cursos)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/grupos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:participantes|sesiones(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?)$/iu.test(
      normalizedPath,
    )
  )
    return {
      access: "ROLES",
      roles: normalizedPath.startsWith("/app/mis-cursos/")
        ? ["INSTRUCTOR"]
        : ["ADMIN"],
    };
  if (
    /^\/app\/preinscripciones\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalizedPath,
    )
  )
    return { access: "ROLES", roles: ["ADMIN"] };
  if (
    /^\/app\/mis-cursos\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/grupos\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(
      normalizedPath,
    )
  )
    return { access: "ROLES", roles: ["INSTRUCTOR"] };
  if (
    /^\/app\/instructores\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/editar$/iu.test(
      normalizedPath,
    )
  )
    return { access: "ROLES", roles: ["ADMIN"] };
  if (
    /^\/app\/mis-cursos\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(
      normalizedPath,
    )
  )
    return { access: "ROLES", roles: ["INSTRUCTOR"] };
  if (
    COURSE_EDIT_PATH.test(normalizedPath) ||
    COURSE_GROUPS_PATH.test(normalizedPath) ||
    INTEREST_DETAIL_PATH.test(normalizedPath)
  )
    return { access: "ROLES", roles: ["ADMIN"] };
  return FORMAT_DETAIL_PATH.test(normalizedPath)
    ? { access: "ROLES", roles: ["ADMIN"] }
    : null;
}

export function isPrivatePath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export type AuthRouteContext = "NONE" | "CLIENT" | "FULL";

export function getAuthRouteContext(pathname: string): AuthRouteContext {
  if (isPrivatePath(pathname) || pathname === "/login") return "FULL";
  if (pathname.startsWith("/auth/") || pathname === "/recuperar-contrasena")
    return "CLIENT";
  return "NONE";
}

export function isSessionDependentPath(pathname: string): boolean {
  return (
    isPrivatePath(pathname) ||
    pathname === "/login" ||
    pathname === "/recuperar-contrasena" ||
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
