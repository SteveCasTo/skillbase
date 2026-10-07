/** Compare the values transported by the format editor, without business rules. */
export function formatFieldChanged(
  field: string,
  draft: string,
  persisted: string,
): boolean {
  if (field === "name") return draft.trim() !== persisted.trim();
  // Empty/partial drafts are validated by the existing HTML constraints.
  if (!draft.trim() || !persisted.trim()) return draft !== persisted;
  return Number(draft) !== Number(persisted);
}
