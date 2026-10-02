import { afterAll, beforeEach, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, withRequestDatabase } from "@/server/db/client";
import { DrizzleInterestRepository } from "@/server/db/repositories/interest-repository";
import { DrizzleGroupRepository } from "@/server/db/repositories/group-repository";
import {
  auditEvents,
  courses,
  courseTypes,
  courseTypeRevisions,
  groups,
  interestRegistrations,
  interestRegistrationRateLimits,
  users,
} from "@/server/db/schema";
import {
  registerInterest,
  mutateInterest,
  getInterestCourse,
} from "@/application/interests/manage-interests";
import {
  consumeInterestRateLimit,
  rateConfig,
} from "@/server/interests/rate-limit";
import {
  handleAdminInterestPost,
  handlePublicInterestPost,
} from "@/server/interests/http";
import { getPublicAuthEnvironment } from "@/server/environment";
import { parseInterestFilter } from "@/server/interests/filter";
import type { InternalUser } from "@/domain/auth/types";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
const url = getTestSupabaseEnvironment().databaseUrl;
const database = createDatabase(url, { max: 8 });
const db = database.db;
const repo = new DrizzleInterestRepository(db);
let actor: InternalUser;
let course: typeof courses.$inferSelect;
let group: typeof groups.$inferSelect;
const input = {
  firstName: "María José",
  lastName: "Test 李",
  email: " A.B+test@Example.invalid ",
  phone: "+591 123",
};
async function makeCourse() {
  const [type] = await db
    .insert(courseTypes)
    .values({ name: `Interests ${crypto.randomUUID()}` })
    .returning();
  const [revision] = await db
    .insert(courseTypeRevisions)
    .values({
      courseTypeId: type!.id,
      revisionNumber: 1,
      totalHours: 20,
      sessionMinutes: 90,
      studentAmount: "80.00",
      externalAmount: "100.00",
    })
    .returning();
  const [row] = await db
    .insert(courses)
    .values({
      name: "Interests course",
      slug: `interests-${crypto.randomUUID()}`,
      description: "Synthetic test course",
      level: "BASIC",
      courseTypeRevisionId: revision!.id,
      schedule: "Lunes a viernes",
      weekdaysMask: 31,
      conditions: "Test conditions",
      startsAt: new Date("2099-03-02T04:00:00Z"),
      endsAt: new Date("2099-04-01T23:00:00Z"),
      minimumGrade: 50,
      status: "PUBLISHED",
      registrationStartAt: new Date("2098-01-01T00:00:00Z"),
      registrationEndAt: new Date("2099-02-28T00:00:00Z"),
    })
    .returning();
  return row!;
}
beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `interests-${crypto.randomUUID()}@test.invalid`,
      name: "Interest Admin",
      authUserId: crypto.randomUUID(),
      status: "ACTIVE",
    })
    .returning();
  actor = { ...user!, roles: ["ADMIN"] };
  course = await makeCourse();
  const [row] = await db
    .insert(groups)
    .values({
      courseId: course.id,
      courseTypeRevisionId: course.courseTypeRevisionId,
      capacity: 1,
      publishedAt: new Date(),
      startsAt: new Date("2099-03-02T22:00:00Z"),
      endsAt: new Date("2099-03-17T23:30:00Z"),
    })
    .returning();
  group = row!;
});
afterAll(async () => {
  await database.close();
});
async function firstRegistration() {
  const detail = await repo.course(course.id);
  return detail!.registrations[0]!;
}
test("interests concurrent normalized duplicates preserve autonomous first snapshot across every state", async () => {
  await Promise.all(
    Array.from({ length: 12 }, () =>
      registerInterest(repo, course.slug, {
        ...input,
        preferredGroupId: group.id,
      }),
    ),
  );
  const initial = await firstRegistration();
  expect((await repo.course(course.id))!.registrations).toHaveLength(1);
  await registerInterest(repo, course.slug, {
    ...input,
    firstName: "Changed",
    phone: null,
    email: "a.b+test@example.invalid",
  });
  expect(await firstRegistration()).toEqual(initial);
  const cancelled = await mutateInterest(repo, actor, course.id, {
    intent: "cancel",
    interestRegistrationId: initial.id,
    revision: initial.updatedAt,
  });
  expect(cancelled.ok).toBe(true);
  await registerInterest(repo, course.slug, { ...input, firstName: "Changed" });
  expect((await firstRegistration()).status).toBe("CANCELLED");
  expect((await firstRegistration()).firstName).toBe(initial.firstName);
  const another = await makeCourse();
  await registerInterest(repo, another.slug, input);
  expect((await repo.course(another.id))!.registrations).toHaveLength(1);
});
test("interests public projection excludes PII and capacity, respects closing and groups eligibility", async () => {
  expect(await repo.publicForm(course.slug)).toEqual({
    available: true,
    closesAt: course.registrationEndAt!.toISOString(),
    groups: [{ id: group.id, startTime: "18:00", endTime: "19:30" }],
  });
  await db
    .update(courses)
    .set({
      registrationEndAt: new Date("2000-01-02Z"),
      registrationStartAt: new Date("2000-01-01Z"),
    })
    .where(eq(courses.id, course.id));
  expect((await repo.publicForm(course.slug))!.groups).toEqual([]);
  await expect(
    registerInterest(repo, course.slug, input),
  ).rejects.toMatchObject({ code: "INTEREST_UNAVAILABLE" });
  await db
    .update(courses)
    .set({ status: "DRAFT" })
    .where(eq(courses.id, course.id));
  expect(await repo.publicForm(course.slug)).toBeNull();
  await expect(
    registerInterest(repo, course.slug, input),
  ).rejects.toMatchObject({ code: "COURSE_NOT_FOUND" });
  await expect(registerInterest(repo, "missing", input)).rejects.toMatchObject({
    code: "COURSE_NOT_FOUND",
  });
});
test("interests preferences require same-course published planned group, including duplicate validation", async () => {
  await registerInterest(repo, course.slug, {
    ...input,
    preferredGroupId: group.id,
  });
  const other = await makeCourse();
  const [foreign] = await db
    .insert(groups)
    .values({
      ...group,
      id: crypto.randomUUID(),
      courseId: other.id,
      courseTypeRevisionId: other.courseTypeRevisionId,
    })
    .returning();
  for (const id of [foreign!.id, crypto.randomUUID()])
    await expect(
      registerInterest(repo, course.slug, { ...input, preferredGroupId: id }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    db
      .insert(interestRegistrations)
      .values({
        courseId: course.id,
        firstName: "Test",
        lastName: "Test",
        email: "foreign@test.invalid",
        preferredGroupId: foreign!.id,
      })
      .execute(),
  ).rejects.toThrow();
  const [remainingGroup] = await db
    .insert(groups)
    .values({
      ...group,
      id: crypto.randomUUID(),
      startsAt: new Date(group.startsAt.getTime() + 2 * 60 * 60 * 1000),
      endsAt: new Date(group.endsAt.getTime() + 2 * 60 * 60 * 1000),
    })
    .returning();
  await new DrizzleGroupRepository(db).cancel(
    group.id,
    actor.id,
    group.updatedAt,
  );
  expect((await firstRegistration()).preferredGroupId).toBe(group.id);
  expect((await repo.course(course.id))!.metrics).toEqual({
    courseId: course.id,
    activeTotal: 1,
    byPreference: [
      { preferredGroupId: null, activeCount: 0 },
      { preferredGroupId: group.id, activeCount: 1 },
      { preferredGroupId: remainingGroup!.id, activeCount: 0 },
    ].sort((a, b) =>
      (a.preferredGroupId ?? "").localeCompare(b.preferredGroupId ?? ""),
    ),
  });
  await expect(
    registerInterest(repo, course.slug, {
      ...input,
      preferredGroupId: group.id,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    db.delete(groups).where(eq(groups.id, group.id)).execute(),
  ).rejects.toThrow();
  const [hidden] = await db
    .insert(groups)
    .values({ ...group, id: crypto.randomUUID(), publishedAt: null })
    .returning();
  await expect(
    registerInterest(repo, course.slug, {
      ...input,
      preferredGroupId: hidden!.id,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
test("interests administrative audited transitions are monotonic, stale-safe, ownership-safe and independent of publication", async () => {
  await registerInterest(repo, course.slug, input);
  const initial = await firstRegistration();
  await db
    .update(courses)
    .set({ status: "ARCHIVED" })
    .where(eq(courses.id, course.id));
  const cancelled = await mutateInterest(repo, actor, course.id, {
    intent: "cancel",
    interestRegistrationId: initial.id,
    revision: initial.updatedAt,
  });
  if (!cancelled.ok) throw new Error("Expected mutation");
  expect(cancelled.metrics.activeTotal).toBe(0);
  expect(new Date(cancelled.registration.updatedAt).getTime()).toBeGreaterThan(
    new Date(initial.updatedAt).getTime(),
  );
  const stale = await mutateInterest(repo, actor, course.id, {
    intent: "reactivate",
    interestRegistrationId: initial.id,
    revision: initial.updatedAt,
  });
  expect(stale).toMatchObject({
    ok: false,
    code: "STALE_INTEREST_REGISTRATION",
    registration: cancelled.registration,
  });
  const noOp = await mutateInterest(repo, actor, course.id, {
    intent: "cancel",
    interestRegistrationId: initial.id,
    revision: cancelled.registration.updatedAt,
  });
  expect(noOp).toEqual(cancelled);
  const active = await mutateInterest(repo, actor, course.id, {
    intent: "reactivate",
    interestRegistrationId: initial.id,
    revision: cancelled.registration.updatedAt,
  });
  if (!active.ok) throw new Error("Expected mutation");
  expect(active.metrics.activeTotal).toBe(1);
  const audit = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, initial.id));
  expect(audit.map((row) => row.action)).toEqual([
    "INTEREST_REGISTRATION_CANCELLED",
    "INTEREST_REGISTRATION_REACTIVATED",
  ]);
  expect(audit[0]!.metadata).toEqual({
    courseId: course.id,
    fromStatus: "ACTIVE",
    toStatus: "CANCELLED",
  });
  await expect(
    repo.mutate(
      course.id,
      {
        intent: "cancel",
        interestRegistrationId: initial.id,
        revision: active.registration.updatedAt,
      },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow();
  expect(await firstRegistration()).toEqual(active.registration);
  const another = await makeCourse();
  await expect(
    mutateInterest(repo, actor, another.id, {
      intent: "cancel",
      interestRegistrationId: initial.id,
      revision: active.registration.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "INTEREST_REGISTRATION_NOT_FOUND" });
  await expect(
    getInterestCourse(repo, { ...actor, roles: ["INSTRUCTOR"] }, course.id),
  ).rejects.toThrow();
  await expect(
    getInterestCourse(repo, { ...actor, status: "DISABLED" }, course.id),
  ).rejects.toThrow();
});
test("interests metrics include historical zero buckets and null independently of status-filtered rows", async () => {
  await registerInterest(repo, course.slug, input);
  await registerInterest(repo, course.slug, {
    ...input,
    email: "second@test.invalid",
    preferredGroupId: group.id,
  });
  const initial = await firstRegistration();
  await mutateInterest(repo, actor, course.id, {
    intent: "cancel",
    interestRegistrationId: initial.id,
    revision: initial.updatedAt,
  });
  const active = await getInterestCourse(
    repo,
    actor,
    course.id,
    parseInterestFilter(new URLSearchParams("status=ACTIVE")),
  );
  const cancelled = await getInterestCourse(
    repo,
    actor,
    course.id,
    parseInterestFilter(new URLSearchParams("status=CANCELLED")),
  );
  const all = await getInterestCourse(
    repo,
    actor,
    course.id,
    parseInterestFilter(new URLSearchParams("status=ALL")),
  );
  expect(all!.registrations).toHaveLength(2);
  expect(all!.metrics).toEqual(active!.metrics);
  await expect(
    getInterestCourse(repo, actor, "invalid-course", "ACTIVE"),
  ).rejects.toMatchObject({ status: 404, code: "COURSE_NOT_FOUND" });
  expect(() =>
    parseInterestFilter(new URLSearchParams("status=INVALID")),
  ).toThrow("El filtro no es válido");
  expect(active!.registrations).toHaveLength(1);
  expect(cancelled!.registrations).toHaveLength(1);
  expect(cancelled!.metrics).toEqual(active!.metrics);
  expect(active!.metrics.activeTotal).toBe(
    active!.metrics.byPreference.reduce(
      (sum, bucket) => sum + bucket.activeCount,
      0,
    ),
  );
  expect(
    (await repo.summary()).find((row) => row.courseId === course.id)!
      .activeTotal,
  ).toBe(1);
});
test("interests waiting for parent lock rereads real DB clock after deadline, never transaction now", async () => {
  let releaseLock!: () => void;
  const locked = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let startWaiting!: () => void;
  const waiting = new Promise<void>((resolve) => {
    startWaiting = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await tx
      .select()
      .from(courses)
      .where(eq(courses.id, course.id))
      .for("update");
    await tx
      .update(courses)
      .set({
        registrationStartAt: sql`clock_timestamp()-interval '1 minute'`,
        registrationEndAt: sql`clock_timestamp()+interval '0.25 seconds'`,
      })
      .where(eq(courses.id, course.id));
    releaseLock();
    await waiting;
    await tx.execute(sql`select pg_sleep(0.4)`);
  });
  await locked;
  const registration = registerInterest(repo, course.slug, input);
  startWaiting();
  await expect(registration).rejects.toMatchObject({
    code: "INTEREST_UNAVAILABLE",
  });
  await holder;
  expect((await repo.course(course.id))!.registrations).toHaveLength(0);
});
test("interests parent locks serialize public writes with withdrawal and group cancellation", async () => {
  for (const operation of ["withdraw", "cancel"] as const) {
    const target = operation === "withdraw" ? course : await makeCourse();
    const [targetGroup] = await db
      .insert(groups)
      .values({
        ...group,
        id: crypto.randomUUID(),
        courseId: target.id,
        courseTypeRevisionId: target.courseTypeRevisionId,
      })
      .returning();
    let signalLocked!: () => void;
    let signalRequest!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      signalRequest = resolve;
    });
    const mutation = db.transaction(async (tx) => {
      await tx
        .select()
        .from(courses)
        .where(eq(courses.id, target.id))
        .for("update");
      if (operation === "withdraw")
        await tx
          .update(courses)
          .set({ status: "DRAFT" })
          .where(eq(courses.id, target.id));
      else
        await tx
          .update(groups)
          .set({ status: "CANCELLED" })
          .where(eq(groups.id, targetGroup!.id));
      signalLocked();
      await requestStarted;
    });
    await locked;
    const registration = registerInterest(repo, target.slug, {
      ...input,
      preferredGroupId: targetGroup!.id,
    });
    signalRequest();
    await expect(registration).rejects.toMatchObject({
      code: operation === "withdraw" ? "COURSE_NOT_FOUND" : "VALIDATION_FAILED",
    });
    await mutation;
    expect((await repo.course(target.id))!.registrations).toHaveLength(0);
  }
});

test("interests concurrent administrator mutations return coherent metrics and one audited transition", async () => {
  await registerInterest(repo, course.slug, input);
  const initial = await firstRegistration();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      mutateInterest(repo, actor, course.id, {
        intent: "cancel",
        interestRegistrationId: initial.id,
        revision: initial.updatedAt,
      }),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toHaveLength(5);
  for (const result of results) {
    expect(result.metrics!.activeTotal).toBe(0);
    expect(result.registration!.status).toBe("CANCELLED");
    expect(
      result.metrics!.byPreference.reduce(
        (sum, bucket) => sum + bucket.activeCount,
        0,
      ),
    ).toBe(result.metrics!.activeTotal);
  }
  expect(
    await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, initial.id)),
  ).toHaveLength(1);
});

test("interests limiter persists atomic multi-scope counts across instances, expires bounded buckets and fails closed", async () => {
  const config = { ...rateConfig(), courseLimit: 3, networkLimit: 5 };
  const slug = crypto.randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      consumeInterestRateLimit(db, "192.0.2.10", slug, config),
    ),
  );
  expect(results.filter((retry) => retry === 0)).toHaveLength(3);
  expect(results.filter((retry) => retry > 0)).toHaveLength(9);
  const other = await Promise.all(
    Array.from({ length: 3 }, () =>
      consumeInterestRateLimit(db, "192.0.2.10", crypto.randomUUID(), config),
    ),
  );
  expect(other.every((retry) => retry > 0)).toBe(true);
  const networkOnly = { ...config, courseLimit: 50, networkLimit: 4 };
  const networkResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      consumeInterestRateLimit(
        db,
        "192.0.2.20",
        crypto.randomUUID(),
        networkOnly,
      ),
    ),
  );
  expect(networkResults.filter((retry) => retry === 0)).toHaveLength(4);
  await db.insert(interestRegistrationRateLimits).values({
    key: `expired:${crypto.randomUUID()}`,
    attempts: 1,
    expiresAt: new Date("2000-01-01Z"),
  });
  await consumeInterestRateLimit(db, "192.0.2.30", slug, config);
  const buckets = await db.select().from(interestRegistrationRateLimits);
  expect(buckets.some((row) => row.key.startsWith("expired:"))).toBe(false);
  expect(JSON.stringify(buckets)).not.toContain("192.0.2.");
  await expect(
    consumeInterestRateLimit(db, "", slug, config),
  ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  const unavailableDatabase = createDatabase(url);
  await unavailableDatabase.close();
  await expect(
    consumeInterestRateLimit(
      unavailableDatabase.db,
      "192.0.2.50",
      slug,
      config,
    ),
  ).rejects.toThrow();
});
test("interests HTTP new, duplicate-active and duplicate-cancelled are exactly neutral 200 and validation precedes conflict", async () => {
  const origin = getPublicAuthEnvironment().siteUrl.origin;
  const post = (raw: unknown, mime = "application/json") =>
    withRequestDatabase(
      () =>
        handlePublicInterestPost({
          slug: course.slug,
          clientAddress: "192.0.2.40",
          request: new Request(`${origin}/cursos/${course.slug}`, {
            method: "POST",
            headers: { origin, "content-type": mime },
            body:
              mime === "application/json"
                ? JSON.stringify(raw)
                : new URLSearchParams(raw as Record<string, string>),
          }),
        }),
      undefined,
      url,
    );
  const first = await post(input);
  expect(first.status).toBe(200);
  expect(first.payload).toEqual({
    ok: true,
    message:
      "Gracias por tu interés. Esta solicitud no reserva una plaza ni confirma una inscripción.",
  });
  expect(
    await post(
      { ...input, firstName: "Changed" },
      "application/x-www-form-urlencoded",
    ),
  ).toEqual(first);
  const initial = await firstRegistration();
  await mutateInterest(repo, actor, course.id, {
    intent: "cancel",
    interestRegistrationId: initial.id,
    revision: initial.updatedAt,
  });
  expect(await post(input)).toEqual(first);
  expect(
    (await post({ ...input, preferredGroupId: crypto.randomUUID() })).status,
  ).toBe(422);
  expect((await post({ ...input, courseId: course.id })).status).toBe(400);
  for (let attempt = 0; attempt < 15; attempt++)
    expect((await post(input)).status).toBe(200);
  const limited = await post(input);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers!["Retry-After"])).toBeGreaterThan(0);
  expect((await repo.course(course.id))!.registrations).toHaveLength(1);
  const invalidOrigin = await withRequestDatabase(
    () =>
      handlePublicInterestPost({
        slug: course.slug,
        clientAddress: "192.0.2.40",
        request: new Request(`${origin}/cursos/${course.slug}`, {
          method: "POST",
          headers: {
            origin: "https://invalid.test",
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      }),
    undefined,
    url,
  );
  expect(invalidOrigin.status).toBe(403);
  const saved = process.env.INTEREST_RATE_LIMIT_SECRET;
  try {
    delete process.env.INTEREST_RATE_LIMIT_SECRET;
    expect((await post(input)).status).toBe(503);
  } finally {
    process.env.INTEREST_RATE_LIMIT_SECRET = saved;
  }
  const mutation = {
    intent: "reactivate",
    interestRegistrationId: initial.id,
    revision: (await firstRegistration()).updatedAt,
  };
  const denied = await handleAdminInterestPost({
    courseId: course.id,
    actor: { ...actor, roles: ["INSTRUCTOR"] },
    request: new Request(`${origin}/app/interesados/${course.id}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(mutation),
    }),
  });
  expect(denied.status).toBe(403);
  const adminPost = (raw: unknown, requestOrigin = origin) =>
    withRequestDatabase(
      () =>
        handleAdminInterestPost({
          courseId: course.id,
          actor,
          request: new Request(`${origin}/app/interesados/${course.id}`, {
            method: "POST",
            headers: {
              origin: requestOrigin,
              "content-type": "application/json",
            },
            body: JSON.stringify(raw),
          }),
        }),
      undefined,
      url,
    );
  expect((await adminPost(mutation, "https://invalid.test")).status).toBe(403);
  const reactivated = await adminPost(mutation);
  expect(reactivated.status).toBe(200);
  expect(reactivated.headers!["Cache-Control"]).toBe("private, no-store");
  expect(reactivated.payload).toMatchObject({
    ok: true,
    registration: { status: "ACTIVE" },
    metrics: { activeTotal: 1 },
  });
  const staleResponse = await adminPost({ ...mutation, intent: "cancel" });
  expect(staleResponse.status).toBe(409);
  expect(staleResponse.payload).toMatchObject({
    ok: false,
    code: "STALE_INTEREST_REGISTRATION",
    registration: { status: "ACTIVE" },
    metrics: { activeTotal: 1 },
  });
  const missingAddress = await withRequestDatabase(
    () =>
      handlePublicInterestPost({
        slug: course.slug,
        clientAddress: undefined,
        request: new Request(`${origin}/cursos/${course.slug}`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-forwarded-for": "192.0.2.99",
          },
          body: JSON.stringify(input),
        }),
      }),
    undefined,
    url,
  );
  expect(missingAddress.status).toBe(503);
});
test("interests schema denies Data API roles, protects normalized email and all-state uniqueness", async () => {
  const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
    sql`select relname,relrowsecurity from pg_class where relname in ('interest_registrations','interest_registration_rate_limits')`,
  );
  expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  for (const role of ["anon", "authenticated", "service_role"])
    for (const table of [
      "interest_registrations",
      "interest_registration_rate_limits",
    ]) {
      const [privileges] = await db.execute<{ allowed: boolean }>(
        sql`select has_table_privilege(${role},${table},'SELECT,INSERT,UPDATE,DELETE') as allowed`,
      );
      expect(privileges!.allowed).toBe(false);
    }
  await registerInterest(repo, course.slug, input);
  await expect(
    db
      .insert(interestRegistrations)
      .values({
        courseId: course.id,
        firstName: "Test",
        lastName: "Test",
        email: "a.b+test@example.invalid",
        status: "CANCELLED",
      })
      .execute(),
  ).rejects.toThrow();
  for (const email of [
    " UPPER@test.invalid ",
    "bad",
    "a@b",
    "a\nb@test.invalid",
  ])
    await expect(
      db
        .insert(interestRegistrations)
        .values({
          courseId: course.id,
          firstName: "Test",
          lastName: "Test",
          email,
        })
        .execute(),
    ).rejects.toThrow();
  expect(
    await db
      .select()
      .from(interestRegistrations)
      .where(
        and(
          eq(interestRegistrations.courseId, course.id),
          eq(interestRegistrations.email, "a.b+test@example.invalid"),
        ),
      ),
  ).toHaveLength(1);
});
