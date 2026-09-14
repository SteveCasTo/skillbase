# Drizzle migrations

This directory is intentionally empty of SQL in Phase 0 because the application schema has no business entities yet.

Generate a migration after changing `src/server/db/schema` with `bun run db:generate`. Apply versioned migrations with `bun run db:migrate`; `bun run db:reset` resets Supabase and then applies this directory.
