/** Quote text and neutralize spreadsheet formulas without losing its content. */
export function csvText(value: string, identifier = false): string {
  const unsafe =
    /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value) ||
    /^[\s\p{Cc}\p{Cf}]*[\t\r\n]/u.test(value);
  const safe = identifier || unsafe ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
