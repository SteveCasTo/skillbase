import { CourseInfrastructureError } from "./course-infrastructure-error";

const TRANSIENT_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_POSTGRES_CODES = new Set([
  "40001",
  "40P01",
  "53000",
  "53100",
  "53200",
  "53300",
  "53400",
  "55P03",
  "57P01",
  "57P02",
  "57P03",
]);

interface ErrorDetails {
  readonly code?: unknown;
  readonly cause?: unknown;
}

function details(error: unknown): ErrorDetails | null {
  return typeof error === "object" && error !== null
    ? (error as ErrorDetails)
    : null;
}

function hasTransientCause(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  const value = details(error);
  if (!value) return false;
  if (typeof value.code === "string") {
    if (value.code.startsWith("08")) return true;
    if (TRANSIENT_NETWORK_CODES.has(value.code)) return true;
    if (TRANSIENT_POSTGRES_CODES.has(value.code)) return true;
  }
  return value.cause === undefined
    ? false
    : hasTransientCause(value.cause, seen);
}

export function isTransientPublicCourseReadError(error: unknown): boolean {
  return (
    error instanceof CourseInfrastructureError &&
    error.operation === "listPublic" &&
    hasTransientCause(error.cause)
  );
}
