ALTER TABLE "course_type_revisions" ADD COLUMN "session_minutes" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "weekdays_mask" integer;--> statement-breakpoint
ALTER TABLE "course_type_revisions" ADD CONSTRAINT "course_type_revisions_session_minutes_check" CHECK ("course_type_revisions"."session_minutes" between 15 and 480);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_weekdays_mask_check" CHECK ("courses"."weekdays_mask" between 1 and 31);--> statement-breakpoint
-- Only the exact development seed examples have known session lengths. Other historical
-- revisions remain NULL: neither total hours nor prices establish session duration.
-- Temporarily bypass the immutable-revision trigger solely for this data migration.
ALTER TABLE course_type_revisions DISABLE TRIGGER course_type_revisions_immutable;--> statement-breakpoint
UPDATE course_type_revisions r SET session_minutes = CASE r.total_hours WHEN 20 THEN 90 WHEN 30 THEN 150 END
FROM course_types t WHERE r.course_type_id = t.id AND r.revision_number = 1
  AND ((t.name = 'Formato 20 horas' AND r.total_hours = 20 AND r.student_amount = 80 AND r.external_amount = 100)
    OR (t.name = 'Formato 30 horas' AND r.total_hours = 30 AND r.student_amount = 120 AND r.external_amount = 150));--> statement-breakpoint
ALTER TABLE course_type_revisions ENABLE TRIGGER course_type_revisions_immutable;
