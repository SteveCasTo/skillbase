/** Search equivalence only: never use this value as an identity/deduplication key. */
export function normalizeRegistrationSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-BO")
    .trim()
    .replace(/\s+/gu, " ");
}
