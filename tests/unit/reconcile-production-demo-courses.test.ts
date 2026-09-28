import { describe, expect, test } from "bun:test";

import { RECONCILIATION } from "../../scripts/reconcile-demo-courses";
import {
  buildApplySql,
  parseSnapshotOutput,
  previewSnapshot,
  PROJECT_REF,
  SNAPSHOT_SQL,
  snapshotHash,
} from "../../scripts/reconcile-production-demo-courses";

const actor = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-28T00:00:00.000Z");

function fixture() {
  return parseSnapshotOutput(
    JSON.stringify([
      {
        snapshot: {
          migrationReady: true,
          courses: RECONCILIATION.map(({ slug }, index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            slug,
            status: "DRAFT",
            course_type_revision_id: revision,
            updated_at: "2026-09-27T00:00:00+00:00",
            schedule: "Demo",
            weekdays_mask: null,
            starts_at: "2026-10-01T14:00:00+00:00",
            ends_at: "2026-10-30T15:00:00+00:00",
            registration_start_at: null,
            registration_end_at: null,
          })),
          revisions: [{ id: revision, total_hours: 20, session_minutes: 90 }],
          groups: [],
          auditEvents: [],
        },
      },
    ]),
  );
}

describe("cloud demo reconciliation safeguards", () => {
  test("requires exactly five courses, migration 0009 and no existing groups", () => {
    const snapshot = fixture();
    expect(previewSnapshot(snapshot, now)).toHaveLength(5);
    expect(() =>
      previewSnapshot({ ...snapshot, courses: snapshot.courses.slice(1) }, now),
    ).toThrow("five");
    expect(() =>
      previewSnapshot({ ...snapshot, migrationReady: false }, now),
    ).toThrow("0009");
    expect(() =>
      previewSnapshot(
        { ...snapshot, groups: [{ course_id: snapshot.courses[0]?.id }] },
        now,
      ),
    ).toThrow("Existing groups");
  });

  test("reports changed fields and requires explicit acceptance of audited calendar edits", () => {
    const snapshot = fixture();
    const edited = {
      ...snapshot,
      auditEvents: [
        {
          entity_type: "COURSE",
          entity_id: snapshot.courses[0]?.id,
          action: "COURSE_UPDATED",
          metadata: { fields: "name,startsAt,endsAt" },
        },
      ],
    };
    const preview = previewSnapshot(edited, now);
    expect(preview[0]?.calendarEdited).toBe(true);
    expect(preview[0]?.changedFields).toContain("startsAt");
    expect(() =>
      buildApplySql(edited, actor, snapshotHash(edited), false, now),
    ).toThrow("--accept-edited-calendars");
    expect(
      buildApplySql(edited, actor, snapshotHash(edited), true, now),
    ).toContain("GROUP_CREATED");
  });

  test("fails closed on invalid CLI output, hash or actor", () => {
    expect(() => parseSnapshotOutput("banner\n[]")).toThrow();
    expect(() => parseSnapshotOutput("[]")).toThrow();
    const snapshot = fixture();
    expect(() =>
      buildApplySql(snapshot, actor, "0".repeat(64), false, now),
    ).toThrow("hash");
    expect(() =>
      buildApplySql(snapshot, "bad", snapshotHash(snapshot), false, now),
    ).toThrow("actor");
  });

  test("SQL uses exact slug allowlist, locks, full snapshot recheck, admin check and atomic audits", () => {
    const snapshot = fixture();
    const sql = buildApplySql(
      snapshot,
      actor,
      snapshotHash(snapshot),
      false,
      now,
    );
    expect(PROJECT_REF).toBe("fvzxqlezdrlzykyoevub");
    for (const { slug } of RECONCILIATION) {
      expect(SNAPSHOT_SQL).toContain(`'${slug}'`);
      expect(sql).toContain(`'${slug}'`);
    }
    expect(sql).toContain("pg_advisory_xact_lock(20260915, 3)");
    expect(sql).toContain("pg_advisory_xact_lock(20260915, 1)");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("actual IS DISTINCT FROM");
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(sql).toContain("ur.role_code = 'ADMIN'");
    expect(sql).toContain("AND slug = item->>'slug'");
    expect(sql).toContain(
      "course_type_revision_id = (item->>'revisionId')::uuid AND updated_at",
    );
    expect(sql).toContain("CASE WHEN item->>'status' = 'PUBLISHED'");
    expect(sql).toContain("DEMO_COURSE_RECONCILED");
    expect(sql).toContain("GROUP_CREATED");
    expect(sql).toContain("END $reconcile$;");
  });

  test("untrusted snapshot strings cannot escape the dollar-quoted SQL block", () => {
    const snapshot = fixture();
    snapshot.courses[0]!.schedule =
      "$reconcile$; DROP TABLE public.courses; --";
    const sql = buildApplySql(
      snapshot,
      actor,
      snapshotHash(snapshot),
      false,
      now,
    );
    expect(sql).not.toContain("DROP TABLE");
    expect(sql.match(/\$reconcile\$/gu)).toHaveLength(2);
  });
});
