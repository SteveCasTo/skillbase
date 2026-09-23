export type PosterRowKind = "single" | "pair" | "trio";
export type PairEmphasis = "left" | "right";

export interface PosterRow<T> {
  readonly items: readonly T[];
  readonly kind: PosterRowKind;
  readonly pairEmphasis: PairEmphasis | null;
}

/**
 * Partitions an ordered course list into complete editorial rows.
 * Four remaining posters become two pairs so the final item is never stranded.
 */
export function groupPosterRows<T>(
  items: readonly T[],
): readonly PosterRow<T>[] {
  const rows: PosterRow<T>[] = [];
  let cursor = 0;
  let pairIndex = 0;

  while (cursor < items.length) {
    const remaining = items.length - cursor;
    const size =
      remaining === 4 || remaining === 2 ? 2 : Math.min(3, remaining);
    const rowItems = items.slice(cursor, cursor + size);
    const kind: PosterRowKind =
      size === 3 ? "trio" : size === 2 ? "pair" : "single";
    const pairEmphasis =
      kind === "pair" ? (pairIndex++ % 2 === 0 ? "left" : "right") : null;

    rows.push({ items: rowItems, kind, pairEmphasis });
    cursor += size;
  }

  return rows;
}
