-- Group format/weekdays remain pinned. Date edits are allowed only after an
-- ordinary future calendar cascade in the same transaction; no setting/GUC can
-- bypass this guard. Financial snapshots are intentionally not part of it.
CREATE OR REPLACE FUNCTION public.protect_group_course_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  mutation_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.groups WHERE course_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF (OLD.weekdays_mask, OLD.course_type_revision_id, OLD.schedule)
     IS DISTINCT FROM (NEW.weekdays_mask, NEW.course_type_revision_id, NEW.schedule) THEN
    RAISE EXCEPTION 'Cannot change the schedule or format of a course with groups';
  END IF;
  IF (OLD.starts_at, OLD.ends_at) IS NOT DISTINCT FROM (NEW.starts_at, NEW.ends_at) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'ARCHIVED' OR OLD.starts_at <= mutation_now OR NEW.starts_at <= mutation_now
    OR OLD.weekdays_mask IS DISTINCT FROM 31
    OR EXISTS (SELECT 1 FROM public.evaluation_schemes WHERE course_id = OLD.id AND frozen_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.evaluation_grades WHERE course_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.evaluation_results WHERE course_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.academic_closure_versions WHERE course_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.certificates WHERE course_id = OLD.id)
    OR EXISTS (
      SELECT 1 FROM public.groups g
      LEFT JOIN public.academic_group_states a ON a.group_id = g.id
      WHERE g.course_id = OLD.id AND g.status = 'PLANNED' AND (
        a.closed IS TRUE OR a.last_version > 0 OR g.starts_at <= mutation_now
        OR (g.starts_at AT TIME ZONE 'America/La_Paz')::date <> (NEW.starts_at AT TIME ZONE 'America/La_Paz')::date
        OR (g.ends_at AT TIME ZONE 'America/La_Paz')::date <> (NEW.ends_at AT TIME ZONE 'America/La_Paz')::date
        OR EXISTS (
          SELECT 1 FROM public.group_sessions s WHERE s.group_id = g.id AND (
            s.starts_at <= mutation_now OR s.administrative_review_required OR s.roster_reviewed_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.session_roster WHERE session_id = s.id)
            OR EXISTS (SELECT 1 FROM public.participant_attendance WHERE session_id = s.id)
            OR EXISTS (SELECT 1 FROM public.instructor_attendance WHERE session_id = s.id)
            OR EXISTS (
              SELECT 1 FROM public.audit_events e WHERE e.entity_type = 'SESSION' AND e.entity_id = s.id
              AND (e.action LIKE '%ATTENDANCE%' OR e.action IN ('SESSION_CANCELLED', 'SESSION_REPLACEMENT_CREATED'))
            )
            OR (s.cancelled_at IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM public.audit_events e WHERE e.entity_type = 'SESSION' AND e.entity_id = s.id
                AND e.action = 'SESSION_REPLACED_BY_GROUP_SCHEDULE'
            ))
          )
        )
      )
    ) THEN
    RAISE EXCEPTION 'Course start requires an ordinary future calendar without academic activity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_group_course_plan() FROM PUBLIC, anon, authenticated, service_role;
