import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";

test("forward migration restores explicit unused-format deletion without changing function privileges", async () => {
  const client = postgres(getTestSupabaseEnvironment().databaseUrl, { max: 1 });
  const migration = readFileSync(
    new URL(
      "../../drizzle/0015_restore-format-deletion-guard.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const committed = readFileSync(
    new URL("../../drizzle/0005_delete-unused-formats.sql", import.meta.url),
    "utf8",
  );
  const earlier = committed
    .split("--> statement-breakpoint")[0]!
    .replace(
      "  IF TG_OP = 'DELETE'\n    AND current_setting('app.delete_unused_format_id', true) = OLD.course_type_id::text\n    AND NOT EXISTS (",
      "  IF TG_OP = 'DELETE' AND NOT EXISTS (",
    );
  const formatId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const rollback = new Error("Rollback isolated regression fixture");
  try {
    await client.begin(async (tx) => {
      const before = await tx`
        select pg_get_functiondef(oid) as definition, prosecdef, proconfig, proacl::text
        from pg_proc where oid = 'public.reject_course_type_revision_mutation()'::regprocedure
      `;
      expect(before[0]?.prosecdef).toBe(false);
      await tx.unsafe(earlier);
      await tx`insert into public.course_types (id, name) values (${formatId}, 'Guard regression fixture')`;
      const insert = () => tx`
        insert into public.course_type_revisions
          (id, course_type_id, revision_number, total_hours, session_minutes, student_amount, external_amount)
        values (${revisionId}, ${formatId}, 1, 20, 90, 80, 100)
      `;
      await insert();
      expect(
        await tx`delete from public.course_type_revisions where id = ${revisionId} returning id`,
      ).toHaveLength(1);
      await insert();
      await tx.unsafe(migration);
      const after = await tx`
        select pg_get_functiondef(oid) as definition, prosecdef, proconfig, proacl::text
        from pg_proc where oid = 'public.reject_course_type_revision_mutation()'::regprocedure
      `;
      expect(after).toEqual(before);
      await expect(
        tx.savepoint(async (scope) => {
          await scope`delete from public.course_type_revisions where id = ${revisionId}`;
        }),
      ).rejects.toMatchObject({ code: "P0001" });
      await expect(
        tx.savepoint(async (scope) => {
          await scope`select set_config('app.delete_unused_format_id', ${crypto.randomUUID()}, true)`;
          await scope`delete from public.course_type_revisions where id = ${revisionId}`;
        }),
      ).rejects.toMatchObject({ code: "P0001" });
      await tx`select set_config('app.delete_unused_format_id', ${formatId}, true)`;
      expect(
        await tx`delete from public.course_type_revisions where id = ${revisionId} returning id`,
      ).toHaveLength(1);
      await tx.unsafe(migration);
      const repeated =
        await tx`select pg_get_functiondef(oid) as definition, prosecdef, proconfig, proacl::text
          from pg_proc where oid = 'public.reject_course_type_revision_mutation()'::regprocedure`;
      expect(repeated).toEqual(before);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await client.end();
  }
});
