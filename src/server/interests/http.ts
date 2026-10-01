import { AuthorizationError } from "@/domain/auth/errors";
import type { InternalUser } from "@/domain/auth/types";
import {
  InterestError,
  INTEREST_SUCCESS_MESSAGE,
} from "@/domain/interests/rules";
import type {
  AdminInterestCourseDto,
  AdminInterestPostPayload,
  AdminInterestSummaryDto,
  InterestFormValues,
  InterestStatus,
  PublicInterestFormDto,
  PublicInterestPostPayload,
} from "@/domain/interests/types";
import {
  getInterestCourse,
  listInterestSummary,
  mutateInterest,
  registerInterest,
  requireInterestAdmin,
} from "@/application/interests/manage-interests";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
import { getDatabase } from "@/server/db/client";
import { DrizzleInterestRepository } from "@/server/db/repositories/interest-repository";
import { getPublicAuthEnvironment } from "@/server/environment";
import { consumeInterestRateLimit, rateConfig } from "./rate-limit";
import {
  blankInterestValues,
  ownInterestValues,
  readInterestRequest,
} from "./request";
export type { PublicInterestPostPayload } from "@/domain/interests/types";
const repo = () => new DrizzleInterestRepository(getDatabase());
function assertOrigin(request: Request) {
  if (!requestHasExpectedOrigin(request, getPublicAuthEnvironment().siteUrl))
    throw new InterestError(
      "INVALID_ORIGIN",
      403,
      "No se pudo validar el origen de la solicitud.",
    );
}
function safeError(error: unknown): InterestError {
  if (error instanceof InterestError) return error;
  if (error instanceof AuthorizationError)
    return new InterestError(
      "FORBIDDEN",
      403,
      "No tienes permiso para realizar esta acción.",
    );
  return new InterestError(
    "SERVICE_UNAVAILABLE",
    503,
    "No se pudo completar la solicitud. Intenta nuevamente.",
  );
}
export function loadPublicInterestForm(
  slug: string,
): Promise<PublicInterestFormDto | null> {
  return repo().publicForm(slug);
}
export async function handlePublicInterestPost({
  request,
  slug,
  clientAddress,
}: {
  request: Request;
  slug: string;
  clientAddress: string | undefined;
}): Promise<{
  status: number;
  payload: PublicInterestPostPayload;
  values: InterestFormValues;
  headers?: Record<string, string>;
}> {
  let values = blankInterestValues();
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  try {
    assertOrigin(request);
    const config = rateConfig();
    const raw = await readInterestRequest(request);
    values = ownInterestValues(raw);
    const retry = await consumeInterestRateLimit(
      getDatabase(),
      clientAddress ?? "",
      slug,
      config,
    );
    if (retry) {
      headers["Retry-After"] = String(retry);
      throw new InterestError(
        "RATE_LIMITED",
        429,
        "Demasiadas solicitudes. Intenta nuevamente más tarde.",
      );
    }
    await registerInterest(repo(), slug, raw);
    return {
      status: 200,
      payload: { ok: true, message: INTEREST_SUCCESS_MESSAGE },
      values: blankInterestValues(),
      headers,
    };
  } catch (error) {
    const safe = safeError(error);
    return {
      status: safe.status,
      payload: {
        ok: false,
        code: safe.code,
        message: safe.message,
        issues: safe.issues,
      },
      values,
      headers,
    };
  }
}
export function loadAdminInterestSummary(
  actor: InternalUser,
): Promise<AdminInterestSummaryDto[]> {
  requireInterestAdmin(actor);
  return listInterestSummary(repo(), actor);
}
export function loadAdminInterestCourse(
  actor: InternalUser,
  courseId: string,
  status?: InterestStatus,
): Promise<AdminInterestCourseDto | null> {
  requireInterestAdmin(actor);
  return getInterestCourse(repo(), actor, courseId, status);
}
export async function handleAdminInterestPost({
  request,
  courseId,
  actor,
}: {
  request: Request;
  courseId: string;
  actor: InternalUser;
}): Promise<{
  status: number;
  payload: AdminInterestPostPayload;
  headers?: Record<string, string>;
}> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    requireInterestAdmin(actor);
    assertOrigin(request);
    const raw = await readInterestRequest(request);
    const payload = await mutateInterest(repo(), actor, courseId, raw);
    return { status: payload.ok ? 200 : 409, payload, headers };
  } catch (error) {
    const safe = safeError(error);
    return {
      status: safe.status,
      payload: {
        ok: false,
        code: safe.code,
        message: safe.message,
        issues: safe.issues,
      },
      headers,
    };
  }
}
