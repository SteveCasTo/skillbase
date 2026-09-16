import { describe, expect, test } from "bun:test";

import { requireRoles, resolveActiveUser } from "@/application/auth/authorize";
import {
  completeOAuthCallback,
  type OAuthCallbackGateway,
} from "@/application/auth/complete-oauth-callback";
import type { AuthUserRepository } from "@/application/auth/user-repository";
import { AuthorizationError } from "@/domain/auth/errors";
import { hasAnyRole, normalizeEmail } from "@/domain/auth/policies";
import type { InternalUser } from "@/domain/auth/types";
import { loginRedirect, safeRelativeRedirect } from "@/server/auth/redirects";
import {
  applyPrivateNoStore,
  getPrivateRoutePolicy,
  isSessionDependentPath,
  PRIVATE_ROUTE_POLICIES,
} from "@/server/auth/route-policy";
import { getSupabaseCookieOptions } from "@/server/auth/supabase";
import { RUNTIME_DATABASE_OPTIONS } from "@/server/db/client";
import {
  readPublicAuthEnvironment,
  readServerEnvironment,
} from "@/server/environment";

const activeUser: InternalUser = {
  id: "internal-id",
  authUserId: "auth-id",
  email: "admin@example.test",
  name: "Admin",
  status: "ACTIVE",
  roles: ["ADMIN"],
};

function repositoryWith(user: InternalUser | null): AuthUserRepository {
  return {
    findByAuthUserId: async () => user,
    linkVerifiedInvitation: async () => {
      throw new Error("not used");
    },
    preprovision: async () => {
      throw new Error("not used");
    },
  };
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("authorization policies", () => {
  test("normalizes email and evaluates multiple roles", () => {
    expect(normalizeEmail("  ADMIN@Example.TEST ")).toBe("admin@example.test");
    expect(
      hasAnyRole({ ...activeUser, roles: ["ADMIN", "INSTRUCTOR"] }, [
        "INSTRUCTOR",
      ]),
    ).toBe(true);
  });

  test("rejects unknown, disabled and role-forbidden users", async () => {
    expect(
      await rejectedValue(resolveActiveUser(repositoryWith(null), "auth-id")),
    ).toMatchObject({ code: "NOT_INVITED" });
    expect(
      await rejectedValue(
        resolveActiveUser(
          repositoryWith({ ...activeUser, status: "DISABLED" }),
          "auth-id",
        ),
      ),
    ).toMatchObject({ code: "DISABLED" });
    expect(
      await rejectedValue(
        resolveActiveUser(
          repositoryWith({ ...activeUser, roles: [] }),
          "auth-id",
        ),
      ),
    ).toMatchObject({ code: "NO_ROLES" });
    expect(() => requireRoles(activeUser, ["INSTRUCTOR"])).toThrow(
      AuthorizationError,
    );
  });
});

describe("private route policies and caching", () => {
  test("declares every current route and denies unknown future routes", () => {
    expect(Object.keys(PRIVATE_ROUTE_POLICIES).sort()).toEqual([
      "/app",
      "/app/asistencia",
      "/app/cursos",
      "/app/cursos/nuevo",
    ]);
    expect(getPrivateRoutePolicy("/app")).toEqual({ access: "ACTIVE_USER" });
    expect(getPrivateRoutePolicy("/app/cursos")).toEqual({
      access: "ROLES",
      roles: ["ADMIN"],
    });
    expect(getPrivateRoutePolicy("/app/asistencia/")).toEqual({
      access: "ROLES",
      roles: ["INSTRUCTOR"],
    });
    expect(
      getPrivateRoutePolicy(
        "/app/cursos/10000000-0000-4000-8000-000000000001/editar",
      ),
    ).toEqual({ access: "ROLES", roles: ["ADMIN"] });
    expect(getPrivateRoutePolicy("/app/cursos/not-an-id/editar")).toBeNull();
    expect(getPrivateRoutePolicy("/app/future")).toBeNull();
  });

  test("marks session-dependent responses private and non-cacheable", () => {
    expect(isSessionDependentPath("/app/asistencia")).toBe(true);
    expect(isSessionDependentPath("/auth/logout")).toBe(true);
    expect(isSessionDependentPath("/")).toBe(false);
    const response = new Response();
    applyPrivateNoStore(response);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("Supabase SSR cookies", () => {
  test("uses explicit secure defaults according to the public site protocol", () => {
    expect(getSupabaseCookieOptions(new URL("http://127.0.0.1:4321"))).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(
      getSupabaseCookieOptions(new URL("https://skillbase.example")),
    ).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });
  });
});

describe("OAuth callback orchestration", () => {
  function gateway(
    identity: Awaited<ReturnType<OAuthCallbackGateway["getIdentity"]>>,
  ) {
    let signedOut = false;
    return {
      value: {
        exchangeCode: async () => true,
        getIdentity: async () => identity,
        signOutCurrent: async () => {
          signedOut = true;
        },
      } satisfies OAuthCallbackGateway,
      wasSignedOut: () => signedOut,
    };
  }

  test("links a verified Google identity", async () => {
    let linked = false;
    const authGateway = gateway({
      authUserId: "auth-id",
      email: activeUser.email,
      emailVerified: true,
      providers: ["google"],
    });
    const result = await completeOAuthCallback(
      authGateway.value,
      {
        ...repositoryWith(activeUser),
        linkVerifiedInvitation: async () => {
          linked = true;
          return activeUser;
        },
      },
      "valid-code",
    );
    expect(result).toEqual({ success: true });
    expect(linked).toBe(true);
    expect(authGateway.wasSignedOut()).toBe(false);
  });

  test("rejects a non-Google identity and clears its session", async () => {
    const authGateway = gateway({
      authUserId: "auth-id",
      email: activeUser.email,
      emailVerified: true,
      providers: ["email"],
    });
    expect(
      await completeOAuthCallback(
        authGateway.value,
        repositoryWith(activeUser),
        "valid-code",
      ),
    ).toEqual({ success: false, reason: "invalid_provider" });
    expect(authGateway.wasSignedOut()).toBe(true);
  });
});

describe("safe redirects", () => {
  test("allows local paths and rejects external or scheme-relative values", () => {
    expect(safeRelativeRedirect("/app/cursos?tab=active")).toBe(
      "/app/cursos?tab=active",
    );
    expect(safeRelativeRedirect("https://evil.test/path")).toBe("/app");
    expect(safeRelativeRedirect("//evil.test/path")).toBe("/app");
    expect(loginRedirect("/app/cursos", "?tab=active")).toBe(
      "/login?next=%2Fapp%2Fcursos%3Ftab%3Dactive",
    );
  });
});

describe("environment configuration", () => {
  const publicValues = {
    PUBLIC_SITE_URL: "http://127.0.0.1:4321",
    PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
  };

  test("separates validated public and server-only values", () => {
    expect(readPublicAuthEnvironment(publicValues).supabaseUrl).toBe(
      "http://127.0.0.1:54321",
    );
    expect(
      readServerEnvironment({
        ...publicValues,
        DATABASE_URL: "postgresql://db",
      }).databaseUrl,
    ).toBe("postgresql://db");
    expect(RUNTIME_DATABASE_OPTIONS).toEqual({
      max: 1,
      idleTimeout: 20,
      connectTimeout: 10,
    });
  });

  test("fails closed for missing or unsafe URL configuration", () => {
    expect(() => readPublicAuthEnvironment({})).toThrow(
      "Missing required environment variable",
    );
    expect(() =>
      readPublicAuthEnvironment({
        ...publicValues,
        PUBLIC_SITE_URL: "javascript:unsafe",
      }),
    ).toThrow("absolute HTTP(S) URL");
  });
});
