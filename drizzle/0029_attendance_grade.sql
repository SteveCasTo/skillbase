ALTER TYPE "public"."evaluation_type" ADD VALUE IF NOT EXISTS 'ATTENDANCE';--> statement-breakpoint
ALTER TABLE "evaluation_grades" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.evaluation_grades'::regclass AND conname = 'evaluation_grade_origin_check') THEN
    ALTER TABLE public.evaluation_grades ADD CONSTRAINT evaluation_grade_origin_check CHECK (origin in ('AUTO', 'MANUAL'));
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_attendance_grade_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.origin = 'AUTO' AND NOT EXISTS (
    SELECT 1 FROM public.evaluation_components WHERE id = NEW.component_id
      AND course_id = NEW.course_id AND type::text = 'ATTENDANCE'
  ) THEN
    RAISE EXCEPTION 'Only attendance grades have automatic origin' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evaluation_components WHERE id = NEW.component_id
    AND course_id = NEW.course_id AND type::text = 'ATTENDANCE') THEN
    INSERT INTO public.audit_events (actor_id, entity_type, entity_id, action, metadata)
      VALUES (NEW.recorded_by, 'COURSE', NEW.course_id, 'EVALUATION_ATTENDANCE_GRADE_RECORDED',
        jsonb_build_object('registrationId', NEW.registration_id, 'participantId', NEW.participant_id,
          'componentId', NEW.component_id, 'revision', NEW.revision,
          'fromOrigin', CASE WHEN TG_OP = 'UPDATE' THEN OLD.origin ELSE NULL END,
          'toOrigin', NEW.origin,
          'fromHundredths', CASE WHEN TG_OP = 'UPDATE' THEN OLD.score_hundredths ELSE NULL END,
          'toHundredths', NEW.score_hundredths));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS evaluation_attendance_grade_origin ON public.evaluation_grades;
--> statement-breakpoint
CREATE TRIGGER evaluation_attendance_grade_origin AFTER INSERT OR UPDATE ON public.evaluation_grades
FOR EACH ROW EXECUTE FUNCTION public.record_attendance_grade_origin();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_attendance_grade_origin() FROM PUBLIC, anon, authenticated, service_role;
