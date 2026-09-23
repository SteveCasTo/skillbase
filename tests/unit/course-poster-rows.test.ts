import { describe, expect, test } from "bun:test";

import { groupPosterRows } from "@/components/landing/course-poster-rows";

const cases = [
  { count: 0, sizes: [] },
  { count: 1, sizes: [1] },
  { count: 2, sizes: [2] },
  { count: 3, sizes: [3] },
  { count: 4, sizes: [2, 2] },
  { count: 7, sizes: [3, 2, 2] },
  { count: 19, sizes: [3, 3, 3, 3, 3, 2, 2] },
] as const;

describe("course poster row grouping", () => {
  for (const { count, sizes } of cases) {
    test(`places ${count} secondary items exactly once without gaps`, () => {
      const items = Array.from(
        { length: count },
        (_, index) => `course-${index}`,
      );
      const rows = groupPosterRows(items);
      const flattened = rows.flatMap(({ items: rowItems }) => rowItems);

      expect(rows.map(({ items: rowItems }) => rowItems.length)).toEqual([
        ...sizes,
      ]);
      expect(flattened).toEqual(items);
      expect(new Set(flattened).size).toBe(count);
      expect(rows.every(({ items: rowItems }) => rowItems.length > 0)).toBe(
        true,
      );
    });
  }

  test("alternates emphasis between consecutive pair rows", () => {
    const rows = groupPosterRows(
      Array.from({ length: 7 }, (_, index) => index),
    );
    const pairRows = rows.filter(({ kind }) => kind === "pair");

    expect(pairRows.map(({ pairEmphasis }) => pairEmphasis)).toEqual([
      "left",
      "right",
    ]);
  });
});
