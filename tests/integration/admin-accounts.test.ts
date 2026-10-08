import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { InternalUser } from "@/domain/auth/types";
import {
  createAdminAccount,
  mutateAdminAccount,
  renameAdminAccount,
} from "@/application/admin-accounts/manage-admin-accounts";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
import { DrizzleAuthUserRepository } from "@/server/db/repositories/auth-user-repository";
import { DrizzleFormatRepository } from "@/server/db/repositories/format-repository";
import { adminCredentialGateway } from "@/server/admin-accounts/credentials";
import { requireFreshRegistrationActor } from "@/server/db/repositories/registration-support";
import { resolveActiveUser } from "@/application/auth/authorize";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";
import { AdminAccountError } from "@/domain/admin-accounts/rules";
const env = getTestSupabaseEnvironment();
const db = createDatabase(env.databaseUrl, { max: 8, maxPipeline: 1 });
const repository = new DrizzleAdminAccountRepository(db.db);
const authRepository = new DrizzleAuthUserRepository(db.db);
const privileged = createClient(env.apiUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const gateway = adminCredentialGateway(privileged);
const ownedAuthIds = new Set<string>();
const password = "Synthetic-Admin-Password-2026";
type AdminFixture = InternalUser & { readonly updatedAt: Date };
let first: AdminFixture;
let second: AdminFixture;
async function fixture(name: string): Promise<AdminFixture> {
  const email = `f8-admin-${crypto.randomUUID()}@test.invalid`;
  const authUserId = await gateway.createConfirmedUser(email, password);
  if (!authUserId) throw new Error("QA Auth fixture unavailable");
  ownedAuthIds.add(authUserId);
  const [user] = await db.db
    .insert(s.users)
    .values({
      name,
      email,
      authUserId,
      status: "ACTIVE",
      authPrimaryProvider: "EMAIL",
      updatedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("QA fixture unavailable");
  await db.db
    .insert(s.userRoles)
    .values({ userId: user.id, roleCode: "ADMIN" });
  return { ...user, roles: ["ADMIN"] };
}
async function create(actor = first): Promise<AdminAccountDto> {
  const value = await createAdminAccount(
    repository,
    {
      ...gateway,
      async createConfirmedUser(email, credential) {
        const id = await gateway.createConfirmedUser(email, credential);
        if (id) ownedAuthIds.add(id);
        return id;
      },
    },
    actor,
    {
      name: "Synthetic New Admin",
      email: `f8-admin-${crypto.randomUUID()}@test.invalid`,
      password,
    },
  );
  return value.account!;
}
beforeAll(async () => {
  first = await fixture("Synthetic First Admin");
  second = await fixture("Synthetic Second Admin");
});
afterAll(async () => {
  for (const id of ownedAuthIds) await gateway.deleteUser(id);
  await db.discard();
});

test("two cross-deletes serialize and never leave zero ACTIVE ADMIN, with no special first account", async () => {
  const initial = await repository.list(first.id);
  // This focal file owns its isolated stack; no canonical fixtures or seed are touched.
  expect(
    initial.filter((a) => a.status === "ACTIVE").length,
  ).toBeGreaterThanOrEqual(2);
  const results = await Promise.allSettled([
    repository.beginDeletion(first.id, second.id, "delete", second.updatedAt),
    repository.beginDeletion(second.id, first.id, "delete", first.updatedAt),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const [remaining] = await db.db
    .select({ id: s.users.id })
    .from(s.users)
    .where(
      and(
        eq(s.users.status, "ACTIVE"),
        sql`${s.users.id} in (${first.id}, ${second.id})`,
      ),
    );
  expect(remaining).toBeDefined();
  const active = remaining!.id === first.id ? first : second;
  const disabled = active.id === first.id ? second : first;
  const pending = (await repository.get(active.id, disabled.id))!;
  expect(pending.deletionPending).toBe(true);
  // Temporarily isolate the global invariant inside a rollback-only QA transaction.
  // The explicit IDs come from this isolated stack's authorized list, never canonical data.
  const rollback = new Error("QA rollback-only last-admin proof");
  await expect(
    db.db.transaction(async (tx) => {
      for (const other of initial.filter(
        (a) => a.id !== active.id && a.status === "ACTIVE",
      ))
        await tx
          .update(s.users)
          .set({ status: "DISABLED" })
          .where(eq(s.users.id, other.id));
      const scoped = new DrizzleAdminAccountRepository(tx);
      const own = (await scoped.get(active.id, active.id))!;
      await expect(
        scoped.setActive(
          active.id,
          active.id,
          "deactivate",
          new Date(own.revision),
        ),
      ).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  await expect(repository.authorize(disabled.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  // Complete intent using the remaining authorized actor; create replacement, never resurrect Auth.
  await gateway.deleteUser(disabled.authUserId!);
  await repository.completeDeletion(
    active.id,
    disabled.id,
    disabled.authUserId!,
  );
  first = active;
  second = await fixture("Synthetic Replacement Admin");
});
test("list and detail project last-active lifecycle block without replacing actions", async () => {
  const target = await fixture("Synthetic Last Admin Projection");
  const rollback = new Error("QA rollback-only eligibility projection proof");
  await expect(
    db.db.transaction(async (tx) => {
      // Other integration files also create ADMIN fixtures in this shared,
      // runner-owned stack. Keep exactly two known admins for the eligibility
      // assertion, then one; rollback restores every unrelated fixture.
      await tx.execute(sql`select pg_advisory_xact_lock(20261007, 8)`);
      const activeAdmins = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
        .where(
          and(eq(s.users.status, "ACTIVE"), eq(s.userRoles.roleCode, "ADMIN")),
        );
      const otherIds = [
        ...new Set(
          activeAdmins
            .map((admin) => admin.id)
            .filter((id) => id !== target.id && id !== first.id),
        ),
      ];
      if (otherIds.length)
        await tx
          .update(s.users)
          .set({ status: "DISABLED" })
          .where(inArray(s.users.id, otherIds));

      const activeCount = async () => {
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.users)
          .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
          .where(
            and(
              eq(s.users.status, "ACTIVE"),
              eq(s.userRoles.roleCode, "ADMIN"),
            ),
          );
        return row?.count ?? 0;
      };
      expect(await activeCount()).toBe(2);
      const scoped = new DrizzleAdminAccountRepository(tx);
      expect(await scoped.get(target.id, target.id)).toMatchObject({
        action: "delete",
        lifecycleBlockedReason: null,
      });

      await tx
        .update(s.users)
        .set({ status: "DISABLED" })
        .where(eq(s.users.id, first.id));
      expect(await activeCount()).toBe(1);
      const listed = (await scoped.list(target.id)).find(
        (account) => account.id === target.id,
      );
      expect(listed).toMatchObject({
        action: "delete",
        lifecycleBlockedReason: "last-active-admin",
      });
      expect(await scoped.get(target.id, target.id)).toMatchObject({
        action: "delete",
        lifecycleBlockedReason: "last-active-admin",
      });

      await tx.insert(s.auditEvents).values({
        actorId: target.id,
        entityType: "USER",
        entityId: target.id,
        action: "QA_SYNTHETIC_ADMIN_ACTIVITY",
      });
      expect(await scoped.get(target.id, target.id)).toMatchObject({
        action: "deactivate",
        lifecycleBlockedReason: "last-active-admin",
      });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
test("schema RLS, all Data API grants revoked, restrictive evidence, QA ledger23", async () => {
  const rows = await db.db.execute<{ rls: boolean; grants: boolean }>(
    sql`select relrowsecurity as rls, has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role', oid, 'SELECT,INSERT,UPDATE,DELETE') as grants from pg_class where oid='public.admin_account_deletions'::regclass`,
  );
  expect(rows[0]).toEqual({ rls: true, grants: false });
  const ledger = await db.db.execute<{ count: number }>(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  expect(ledger[0]?.count).toBe(23);
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const migration = journal.entries.find(
    (entry) => entry.tag === "0022_phase8_admin_accounts",
  )!;
  const expectedHash = createHash("sha256")
    .update(readFileSync("drizzle/0022_phase8_admin_accounts.sql", "utf8"))
    .digest("hex");
  const applied = await db.db.execute<{ hash: string; created_at: string }>(
    sql`select hash, created_at::text from drizzle.__drizzle_migrations where created_at = ${migration.when}`,
  );
  expect(applied[0]).toEqual({
    hash: expectedHash,
    created_at: String(migration.when),
  });
  const intent = await db.db.select().from(s.adminAccountDeletions).limit(1);
  expect(intent[0]?.completedAt).not.toBeNull();
  await expect(
    db.db
      .update(s.adminAccountDeletions)
      .set({ actorId: second.id })
      .where(eq(s.adminAccountDeletions.userId, intent[0]!.userId))
      .execute(),
  ).rejects.toThrow();
  await expect(
    db.db
      .delete(s.adminAccountDeletions)
      .where(eq(s.adminAccountDeletions.userId, intent[0]!.userId))
      .execute(),
  ).rejects.toThrow();
  await expect(
    db.db.delete(s.users).where(eq(s.users.id, intent[0]!.userId)).execute(),
  ).rejects.toThrow();
});
test("confirmed Auth creation yields exclusive ADMIN, normalized readonly email, no professional profile/secret, actor audit real UUID", async () => {
  const account = await create();
  expect(account).toMatchObject({
    hasActivity: false,
    action: "delete",
    exclusiveAdmin: true,
    status: "ACTIVE",
  });
  const [user] = await db.db
    .select()
    .from(s.users)
    .where(eq(s.users.id, account.id));
  expect(user?.authPrimaryProvider).toBe("EMAIL");
  const { data, error } = await privileged.auth.admin.getUserById(
    user!.authUserId!,
  );
  expect(error).toBeNull();
  expect(data.user?.email_confirmed_at).toBeTruthy();
  expect(
    await db.db
      .select()
      .from(s.instructorProfiles)
      .where(eq(s.instructorProfiles.id, account.id)),
  ).toHaveLength(0);
  const events = await db.db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.entityId, account.id));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorId: first.id,
    action: "ADMIN_ACCOUNT_CREATED",
  });
  expect(JSON.stringify({ account, events, user })).not.toContain(password);
  await expect(
    createAdminAccount(repository, gateway, first, {
      name: "Another",
      email: account.email,
      password,
    }),
  ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
});
test("name edits/revision and own edits share audit; target events alone are not activity, own changes count", async () => {
  const account = await create();
  const renamed = await renameAdminAccount(
    repository,
    second,
    account.id,
    "New Synthetic Name",
    account.revision,
  );
  expect(renamed.account?.email).toBe(account.email);
  expect(renamed.account?.hasActivity).toBe(false);
  await expect(
    renameAdminAccount(
      repository,
      first,
      account.id,
      "Stale",
      account.revision,
    ),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const own = await authRepository.findByAuthUserId(
    (await db.db.select().from(s.users).where(eq(s.users.id, account.id)))[0]!
      .authUserId!,
  );
  const value = await renameAdminAccount(
    repository,
    own!,
    account.id,
    "Own Synthetic Name",
    renamed.account!.revision,
  );
  expect(value.account).toMatchObject({
    hasActivity: true,
    action: "deactivate",
  });
  await expect(
    mutateAdminAccount(
      repository,
      gateway,
      first,
      account.id,
      "delete",
      value.account!.revision,
    ),
  ).rejects.toMatchObject({ code: "ACCOUNT_USED" });
  const [audit] = await db.db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.actorId, account.id),
        eq(s.auditEvents.action, "USER_PROFILE_UPDATED"),
      ),
    );
  expect(audit?.metadata).toEqual({ fields: "name" });
});
test("used account deactivation denies old sessions/fresh loaders, reactivation preserves provider/password/UUID", async () => {
  const actor = await fixture("Synthetic Used Admin");
  await renameAdminAccount(
    repository,
    actor,
    actor.id,
    "Synthetic Used Renamed",
    actor.updatedAt.toISOString(),
  );
  const previous = (await repository.get(first.id, actor.id))!;
  const anon = createClient(env.apiUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await anon.auth.signInWithPassword({
    email: actor.email,
    password,
  });
  expect(login.error).toBeNull();
  const disabled = await mutateAdminAccount(
    repository,
    gateway,
    first,
    actor.id,
    "deactivate",
    previous.revision,
  );
  expect(disabled.account?.action).toBe("activate");
  await expect(
    resolveActiveUser(authRepository, actor.authUserId!),
  ).rejects.toThrow();
  await expect(repository.list(actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await mutateAdminAccount(
    repository,
    gateway,
    first,
    actor.id,
    "activate",
    disabled.account!.revision,
  );
  const fresh = await resolveActiveUser(authRepository, actor.authUserId!);
  expect(fresh.id).toBe(actor.id);
  expect(
    (await anon.auth.signInWithPassword({ email: actor.email, password }))
      .error,
  ).toBeNull();
  expect(fresh.authPrimaryProvider).toBe("EMAIL");
  await anon.auth.signOut({ scope: "local" });
});
test("Auth failure stays DISABLED pending, stale retries reject, original/current revisions replay once, final tombstone retains UUID evidence", async () => {
  const account = await create();
  const failGateway = {
    ...gateway,
    async deleteUser() {
      throw new Error("QA forced provider outage");
    },
  };
  await expect(
    mutateAdminAccount(
      repository,
      failGateway,
      first,
      account.id,
      "delete",
      account.revision,
    ),
  ).rejects.toMatchObject({ code: "DELETION_PENDING" });
  const pending = (await repository.get(second.id, account.id))!;
  expect(pending).toMatchObject({
    status: "DISABLED",
    deletionPending: true,
    action: "retry-delete",
  });
  await expect(
    mutateAdminAccount(
      repository,
      gateway,
      second,
      account.id,
      "activate",
      pending.revision,
    ),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(
    mutateAdminAccount(
      repository,
      gateway,
      second,
      account.id,
      "retry-delete",
      "2020-01-01T00:00:00.000Z",
    ),
  ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
  const value = await mutateAdminAccount(
    repository,
    gateway,
    second,
    account.id,
    "delete",
    account.revision,
  );
  expect(value.deleted).toBe(true);
  expect(
    (
      await mutateAdminAccount(
        repository,
        gateway,
        second,
        account.id,
        "delete",
        account.revision,
      )
    ).deleted,
  ).toBe(true);
  const [tombstone] = await db.db
    .select()
    .from(s.users)
    .where(eq(s.users.id, account.id));
  expect(tombstone?.status).toBe("DISABLED");
  expect(tombstone?.email).toBe(`deleted-${account.id}@tombstone.invalid`);
  expect(
    await db.db
      .select()
      .from(s.userRoles)
      .where(eq(s.userRoles.userId, account.id)),
  ).toHaveLength(0);
  const [intent] = await db.db
    .select()
    .from(s.adminAccountDeletions)
    .where(eq(s.adminAccountDeletions.userId, account.id));
  expect(intent?.actorId).toBe(first.id);
  expect(intent?.completedAt).not.toBeNull();
  const audits = await db.db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.entityId, account.id));
  expect(
    audits.filter((e) => e.action === "ADMIN_ACCOUNT_DELETION_REQUESTED"),
  ).toHaveLength(1);
  expect(
    audits.filter((e) => e.action === "ADMIN_ACCOUNT_DELETED"),
  ).toHaveLength(1);
  expect(
    audits.find((e) => e.action === "ADMIN_ACCOUNT_DELETED")?.actorId,
  ).toBe(second.id);
});
test("self-disable and unused self-delete allowed with another active ADMIN; completion exception cannot authorize further operations", async () => {
  const self = await fixture("Synthetic Self Used");
  await renameAdminAccount(
    repository,
    self,
    self.id,
    "Synthetic Own Edit",
    self.updatedAt.toISOString(),
  );
  const state = (await repository.get(self.id, self.id))!;
  const value = await mutateAdminAccount(
    repository,
    gateway,
    self,
    self.id,
    "deactivate",
    state.revision,
  );
  expect(value.actorActive).toBe(false);
  await expect(repository.authorize(self.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const unused = await fixture("Synthetic Self Unused");
  const removed = await mutateAdminAccount(
    repository,
    gateway,
    unused,
    unused.id,
    "delete",
    unused.updatedAt.toISOString(),
  );
  expect(removed).toEqual({ account: null, actorActive: false, deleted: true });
  await expect(repository.authorize(unused.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
test("fresh actor roles and exclusive target guards prevent multi-role demotion/profile deletion", async () => {
  const target = await create();
  await db.db
    .insert(s.userRoles)
    .values({ userId: target.id, roleCode: "INSTRUCTOR" });
  expect((await repository.get(first.id, target.id))?.action).toBeNull();
  await expect(
    mutateAdminAccount(
      repository,
      gateway,
      first,
      target.id,
      "delete",
      target.revision,
    ),
  ).rejects.toMatchObject({ code: "ROLE_NOT_EXCLUSIVE" });
  await expect(
    renameAdminAccount(
      repository,
      first,
      target.id,
      "Illegal",
      target.revision,
    ),
  ).rejects.toMatchObject({ code: "ROLE_NOT_EXCLUSIVE" });
  const actor = await fixture("Synthetic Revoked Actor");
  await db.db.delete(s.userRoles).where(eq(s.userRoles.userId, actor.id));
  await expect(repository.list(actor.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const pending = await create();
  await repository.beginDeletion(
    first.id,
    pending.id,
    "delete",
    new Date(pending.revision),
  );
  await db.db
    .insert(s.userRoles)
    .values({ userId: pending.id, roleCode: "INSTRUCTOR" });
  await expect(
    repository.beginDeletion(
      second.id,
      pending.id,
      "retry-delete",
      new Date(pending.revision),
    ),
  ).rejects.toMatchObject({ code: "ROLE_NOT_EXCLUSIVE" });
  // Neither retry nor finalization may remove a newly observed professional role.
  const [internal] = await db.db
    .select()
    .from(s.users)
    .where(eq(s.users.id, pending.id));
  expect(
    (await privileged.auth.admin.getUserById(internal!.authUserId!)).error,
  ).toBeNull();
});
test("actor activity read-lock blocks deletion until commit, then used guard rejects; deletion first denies new business writes", async () => {
  const target = await create();
  let locked!: () => void;
  const lockReady = new Promise<void>((r) => (locked = r));
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const writer = createDatabase(env.databaseUrl, { max: 1, maxPipeline: 1 });
  const activity = writer.db.transaction(async (tx) => {
    await requireFreshRegistrationActor(tx, target.id);
    locked();
    await barrier;
    await tx.insert(s.auditEvents).values({
      actorId: target.id,
      entityType: "USER",
      entityId: target.id,
      action: "QA_SYNTHETIC_ACTIVITY",
    });
  });
  try {
    await Promise.race([lockReady, activity]);
    const deletion = repository.beginDeletion(
      first.id,
      target.id,
      "delete",
      new Date(target.revision),
    );
    release();
    await activity;
    await expect(deletion).rejects.toMatchObject({ code: "ACCOUNT_USED" });
  } finally {
    release();
    await writer.discard();
  }
  const unused = await create();
  await repository.beginDeletion(
    first.id,
    unused.id,
    "delete",
    new Date(unused.revision),
  );
  await expect(
    new DrizzleFormatRepository(db.db).create(
      `Synthetic denied ${crypto.randomUUID()}`,
      {
        totalHours: 3,
        sessionMinutes: 90,
        studentAmount: "10.00",
        externalAmount: "20.00",
      },
      unused.id,
    ),
  ).rejects.toThrow();
  await expect(
    authRepository.recordPasswordChanged(unused.id),
  ).rejects.toThrow();
  await gateway.deleteUser(
    (await db.db.select().from(s.users).where(eq(s.users.id, unused.id)))[0]!
      .authUserId!,
  );
  await repository.completeDeletion(
    first.id,
    unused.id,
    (await db.db.select().from(s.users).where(eq(s.users.id, unused.id)))[0]!
      .authUserId!,
  );
});
test("revocation during privileged creation compensates only newly created Auth identity and leaves no internal account", async () => {
  const actor = await fixture("Synthetic Create Revoked");
  let newId: string | null = null;
  const email = `f8-admin-${crypto.randomUUID()}@test.invalid`;
  const compensating = {
    ...gateway,
    async createConfirmedUser(e: string, p: string) {
      newId = await gateway.createConfirmedUser(e, p);
      if (newId) ownedAuthIds.add(newId);
      await db.db
        .update(s.users)
        .set({ status: "DISABLED" })
        .where(eq(s.users.id, actor.id));
      return newId;
    },
  };
  await expect(
    createAdminAccount(repository, compensating, actor, {
      name: "Synthetic Cannot Persist",
      email,
      password,
    }),
  ).rejects.toBeInstanceOf(AdminAccountError);
  expect(
    await db.db.select().from(s.users).where(eq(s.users.email, email)),
  ).toHaveLength(0);
  expect((await privileged.auth.admin.getUserById(newId!)).error?.code).toBe(
    "user_not_found",
  );
  expect(
    (await privileged.auth.admin.getUserById(first.authUserId!)).error,
  ).toBeNull();
});
