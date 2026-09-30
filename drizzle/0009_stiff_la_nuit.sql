ALTER TABLE "groups" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
-- Reconstruct exposure from course publication windows and group cancellation history.
-- An active group at publication or one created while published has been public.
-- If course publication audit is missing but the status/withdrawal proves exposure,
-- err on the side of retaining history instead of making an uncertain group deletable.
UPDATE public.groups AS g
SET published_at = COALESCE(
  (
    SELECT min(greatest(g.created_at, published.created_at))
    FROM public.audit_events AS published
    WHERE published.entity_type = 'COURSE'
      AND published.entity_id = g.course_id
      AND published.action = 'COURSE_PUBLISHED'
      AND (
        (g.created_at <= published.created_at AND NOT EXISTS (
          SELECT 1 FROM public.audit_events AS cancelled
          WHERE cancelled.entity_type = 'GROUP'
            AND cancelled.entity_id = g.id
            AND cancelled.action = 'GROUP_CANCELLED'
            AND cancelled.created_at < published.created_at
        ))
        OR (g.created_at > published.created_at AND NOT EXISTS (
          SELECT 1 FROM public.audit_events AS withdrawn
          WHERE withdrawn.entity_type = 'COURSE'
            AND withdrawn.entity_id = g.course_id
            AND withdrawn.action IN ('COURSE_WITHDRAWN', 'COURSE_ARCHIVED')
            AND withdrawn.created_at >= published.created_at
            AND withdrawn.created_at < g.created_at
        ))
      )
  ),
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.audit_events AS published
    WHERE published.entity_type = 'COURSE'
      AND published.entity_id = g.course_id
      AND published.action = 'COURSE_PUBLISHED'
  ) AND (
    EXISTS (SELECT 1 FROM public.courses AS c WHERE c.id = g.course_id AND c.status = 'PUBLISHED')
    OR EXISTS (
      SELECT 1 FROM public.audit_events AS withdrawn
      WHERE withdrawn.entity_type = 'COURSE' AND withdrawn.entity_id = g.course_id
        AND withdrawn.action = 'COURSE_WITHDRAWN'
    )
  ) THEN g.created_at ELSE NULL END
)
WHERE g.published_at IS NULL;
--> statement-breakpoint
-- An exposed group can never become deletable again, even through a direct DB write.
CREATE FUNCTION public.protect_published_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Published groups cannot be deleted';
    END IF;
    IF NEW.published_at IS NULL OR NEW.published_at <> OLD.published_at THEN
      RAISE EXCEPTION 'Group publication history is immutable';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER groups_protect_published BEFORE UPDATE OR DELETE ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.protect_published_group();
