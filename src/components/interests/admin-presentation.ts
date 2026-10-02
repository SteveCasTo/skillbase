import type {
  AdminInterestMetricsDto,
  AdminInterestRegistrationDto,
} from "@/domain/interests/types";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  iso.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Each bar is a share of all active interest, never of the largest bucket. */
export function preferenceDemand(metrics: AdminInterestMetricsDto) {
  const highest = Math.max(
    0,
    ...metrics.byPreference.map((item) => item.activeCount),
  );
  return metrics.byPreference.map((bucket) => ({
    ...bucket,
    share:
      metrics.activeTotal > 0
        ? (bucket.activeCount / metrics.activeTotal) * 100
        : 0,
    leading: highest > 0 && bucket.activeCount === highest,
  }));
}

export function isAdminRegistration(
  value: unknown,
  courseId: string,
  registrationId: string,
): value is AdminInterestRegistrationDto {
  return (
    object(value) &&
    identifier(value.id) &&
    value.id === registrationId &&
    value.courseId === courseId &&
    identifier(value.courseId) &&
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    typeof value.email === "string" &&
    (value.phone === null || typeof value.phone === "string") &&
    (value.preferredGroupId === null || identifier(value.preferredGroupId)) &&
    (value.status === "ACTIVE" || value.status === "CANCELLED") &&
    instant(value.createdAt) &&
    instant(value.updatedAt)
  );
}

export function isAdminMetrics(
  value: unknown,
  courseId: string,
): value is AdminInterestMetricsDto {
  if (
    !object(value) ||
    value.courseId !== courseId ||
    !count(value.activeTotal) ||
    !Array.isArray(value.byPreference)
  )
    return false;
  const seen = new Set<string | null>();
  let total = 0;
  for (const bucket of value.byPreference) {
    if (
      !object(bucket) ||
      !(
        bucket.preferredGroupId === null || identifier(bucket.preferredGroupId)
      ) ||
      !count(bucket.activeCount) ||
      seen.has(bucket.preferredGroupId)
    )
      return false;
    seen.add(bucket.preferredGroupId);
    total += bucket.activeCount;
  }
  return (
    seen.has(null) && Number.isSafeInteger(total) && total === value.activeTotal
  );
}

export function visibleAfterMutation(
  filter: string,
  status: AdminInterestRegistrationDto["status"],
): boolean {
  return filter === "" || filter === status;
}
