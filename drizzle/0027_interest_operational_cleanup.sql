-- Keep immutable financial source links; discard only demand with no business use.
DELETE FROM public.interest_registrations i
WHERE NOT EXISTS (SELECT 1 FROM public.pre_registrations p WHERE p.source_interest_id = i.id)
  AND (i.status = 'CANCELLED' OR EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = i.course_id AND c.status <> 'PUBLISHED'
  ));
--> statement-breakpoint
CREATE FUNCTION public.cleanup_unpublished_course_interests() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status <> 'PUBLISHED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    DELETE FROM public.interest_registrations i
    WHERE i.course_id = NEW.id
      AND NOT EXISTS (SELECT 1 FROM public.pre_registrations p WHERE p.source_interest_id = i.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cleanup_unpublished_course_interests() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER cleanup_unpublished_course_interests
AFTER UPDATE OF status ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.cleanup_unpublished_course_interests();
