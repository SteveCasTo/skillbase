ALTER TABLE "courses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
-- Only convert structured rows whose informational schedule matches the old
-- generated hourly pattern. Keep historical free-text courses untouched.
-- Keep courses with existing groups on their historical plan: their calendar
-- is locked and must not be rewritten by a schema migration. Courses whose
-- registration closes on the first day retain their hourly plan as well:
-- moving their start to midnight would invalidate the registration window.
UPDATE courses SET
  starts_at = (starts_at AT TIME ZONE 'America/La_Paz')::date::timestamp AT TIME ZONE 'America/La_Paz',
  ends_at = ((ends_at AT TIME ZONE 'America/La_Paz')::date + time '23:59') AT TIME ZONE 'America/La_Paz',
  schedule = 'Lunes a viernes · horario por grupo',
  updated_at = date_trunc('milliseconds', greatest(now(), updated_at) + interval '1 millisecond')
WHERE weekdays_mask = 31
  AND NOT EXISTS (SELECT 1 FROM groups WHERE groups.course_id = courses.id)
  AND (registration_end_at IS NULL OR registration_end_at <
    ((starts_at AT TIME ZONE 'America/La_Paz')::date::timestamp AT TIME ZONE 'America/La_Paz'))
  AND schedule ~ '^Lunes a viernes, ([01][0-9]|2[0-3]):[0-5][0-9]–([01][0-9]|2[0-3]):[0-5][0-9]$';
