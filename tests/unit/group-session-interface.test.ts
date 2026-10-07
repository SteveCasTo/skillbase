import { expect, test } from "bun:test";
import { filterSessionRows } from "@/components/attendance/session-filter";
import { groupParticipantsQuery } from "@/components/attendance/participants-query";

const courseId = crypto.randomUUID();
const groupId = crypto.randomUUID();

test("calendar combines date with each DTO state and reset date preserves the state", () => {
  const rows = ["UPCOMING", "ONGOING", "COMPLETED", "CANCELLED"].flatMap(
    (status) => [
      {
        hidden: false,
        dataset: { sessionDay: "2026-10-07", sessionStatus: status },
      },
      {
        hidden: false,
        dataset: { sessionDay: "2026-10-08", sessionStatus: status },
      },
    ],
  );
  expect(filterSessionRows(rows, "")).toBe(8);
  for (const status of [
    "UPCOMING",
    "ONGOING",
    "COMPLETED",
    "CANCELLED",
  ] as const) {
    expect(filterSessionRows(rows, "2026-10-07", status)).toBe(1);
    expect(
      rows.filter((row) => !row.hidden).map((row) => row.dataset.sessionStatus),
    ).toEqual([status]);
    expect(filterSessionRows(rows, "", status)).toBe(2);
  }
  expect(filterSessionRows(rows, "2026-10-09", "ONGOING")).toBe(0);
  expect(filterSessionRows(rows, "", "ALL")).toBe(8);
});

test("group roster forwards decoded broad search and server pagination inside course/group scope", () => {
  const url = new URL(
    "https://test.invalid/participants?search=Ana%2BQA%40example.invalid&page=2",
  );
  expect(groupParticipantsQuery(url, courseId, groupId)).toEqual({
    courseId,
    groupId,
    search: "Ana+QA@example.invalid",
    page: 2,
    pageSize: 30,
  });
  const first = new URL(
    "https://test.invalid/participants?search=%20Nombre%20",
  );
  expect(groupParticipantsQuery(first, courseId, groupId)).toMatchObject({
    search: "Nombre",
    page: 1,
    pageSize: 30,
  });
});

test("group roster rejects duplicated query, excessive search and invalid pagination using existing limits", () => {
  for (const query of [
    "page=0",
    "page=1001",
    "page=1.5",
    "page=9007199254740992",
    "page=1&page=2",
    "search=one&search=two",
    `search=${"a".repeat(201)}`,
  ]) {
    expect(() =>
      groupParticipantsQuery(
        new URL(`https://test.invalid/?${query}`),
        courseId,
        groupId,
      ),
    ).toThrow();
  }
  expect(() =>
    groupParticipantsQuery(new URL("https://test.invalid/"), "bad", groupId),
  ).toThrow();
});
