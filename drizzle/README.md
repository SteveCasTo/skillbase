# Drizzle migrations

Drizzle Kit owns the ordered application-schema history. `0000` introduces the internal Auth-domain tables (`users`, `roles`, `user_roles`; not Supabase `auth.users`) and `0001` introduces Phase 2A courses, prices, and audit events.

Generate a migration after changing `src/server/db/schema` with `bun run db:generate`. Review generated SQL and append only platform security statements that Drizzle cannot model (currently RLS enablement and explicit Data API privilege revocation). Apply versioned migrations with `bun run db:migrate`; `bun run db:reset` resets local Supabase and then applies this directory from an empty database.

Never edit a migration already applied outside local development. Runtime uses `DATABASE_URL`; generation and migration prefer `MIGRATION_DATABASE_URL`.
