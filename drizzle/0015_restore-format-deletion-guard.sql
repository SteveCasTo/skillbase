-- Reassert the committed deletion guard for databases that applied an earlier
-- local version of 0005. Preserve historical migration files and ledger hashes.
CREATE OR REPLACE FUNCTION public.reject_course_type_revision_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.delete_unused_format_id', true) = OLD.course_type_id::text
    AND NOT EXISTS (
    SELECT 1 FROM public.courses c
    JOIN public.course_type_revisions r ON r.id = c.course_type_revision_id
    WHERE r.course_type_id = OLD.course_type_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Course type revisions are immutable';
END $$;
