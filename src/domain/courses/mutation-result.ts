export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export const isRevision = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};

export function isCourseSaveResult(
  value: unknown,
): value is { revision: string; name: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "revision" in value &&
    isRevision(value.revision) &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim(),
  );
}

export function isEditorialResult(
  value: unknown,
  intent: string,
): value is {
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  revision: string;
  featured: boolean;
} {
  if (!["publish", "withdraw", "archive", "feature"].includes(intent))
    return false;
  if (
    !value ||
    typeof value !== "object" ||
    !("revision" in value) ||
    !isRevision(value.revision) ||
    !("status" in value) ||
    !("featured" in value) ||
    typeof value.featured !== "boolean"
  )
    return false;
  const expected =
    intent === "withdraw"
      ? "DRAFT"
      : intent === "archive"
        ? "ARCHIVED"
        : "PUBLISHED";
  return (
    value.status === expected &&
    (expected === "PUBLISHED" || !value.featured) &&
    (intent !== "feature" || value.featured)
  );
}
