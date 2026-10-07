CREATE TYPE "public"."evaluation_type" AS ENUM('THEORY', 'PRACTICAL');--> statement-breakpoint
CREATE TABLE "evaluation_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_receipt_fingerprint_check" CHECK ("evaluation_command_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "evaluation_command_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evaluation_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "evaluation_type" NOT NULL,
	"weight_hundredths" integer NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "evaluation_component_course_id_unique" UNIQUE("course_id","id"),
	CONSTRAINT "evaluation_component_order_unique" UNIQUE("course_id","sort_order"),
	CONSTRAINT "evaluation_component_weight_check" CHECK ("evaluation_components"."weight_hundredths" between 0 and 10000),
	CONSTRAINT "evaluation_component_name_check" CHECK (char_length(btrim("evaluation_components"."name")) between 1 and 100 and "evaluation_components"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "evaluation_component_order_check" CHECK ("evaluation_components"."sort_order" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "evaluation_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evaluation_grades" (
	"course_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"score_hundredths" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "evaluation_grades_course_id_participant_id_component_id_pk" PRIMARY KEY("course_id","participant_id","component_id"),
	CONSTRAINT "evaluation_grade_score_check" CHECK ("evaluation_grades"."score_hundredths" between 0 and 10000 and "evaluation_grades"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "evaluation_grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"course_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"final_hundredths" integer,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "evaluation_results_course_id_participant_id_pk" PRIMARY KEY("course_id","participant_id"),
	CONSTRAINT "evaluation_result_final_check" CHECK ("evaluation_results"."final_hundredths" is null or "evaluation_results"."final_hundredths" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "evaluation_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evaluation_schemes" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"frozen_at" timestamp (3) with time zone,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_scheme_revision_check" CHECK ("evaluation_schemes"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "evaluation_schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluation_command_receipts" ADD CONSTRAINT "evaluation_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_components" ADD CONSTRAINT "evaluation_components_course_id_evaluation_schemes_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."evaluation_schemes"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_grades" ADD CONSTRAINT "evaluation_grades_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_grades" ADD CONSTRAINT "evaluation_grades_registration_id_pre_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."pre_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_grades" ADD CONSTRAINT "evaluation_grades_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_grades" ADD CONSTRAINT "evaluation_grade_component_fk" FOREIGN KEY ("course_id","component_id") REFERENCES "public"."evaluation_components"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_course_id_evaluation_schemes_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."evaluation_schemes"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_schemes" ADD CONSTRAINT "evaluation_schemes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_schemes" ADD CONSTRAINT "evaluation_schemes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_receipts_actor_key_unique" ON "evaluation_command_receipts" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE INDEX "evaluation_grade_component_idx" ON "evaluation_grades" USING btree ("course_id","component_id");--> statement-breakpoint
CREATE INDEX "evaluation_grade_participant_idx" ON "evaluation_grades" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "evaluation_grade_registration_idx" ON "evaluation_grades" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "evaluation_grade_actor_idx" ON "evaluation_grades" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "evaluation_result_participant_idx" ON "evaluation_results" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "evaluation_scheme_actor_idx" ON "evaluation_schemes" USING btree ("updated_by");
--> statement-breakpoint
REVOKE ALL ON TABLE public.evaluation_schemes, public.evaluation_components,
  public.evaluation_grades, public.evaluation_results, public.evaluation_command_receipts
  FROM anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.guard_evaluation_scheme() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.course_id IS DISTINCT FROM OLD.course_id
    OR NEW.revision <> OLD.revision + 1
    OR (OLD.frozen_at IS NOT NULL AND NEW.frozen_at IS DISTINCT FROM OLD.frozen_at) THEN
    RAISE EXCEPTION 'Evaluation scheme and permanent freeze are retained' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evaluation_scheme_guard BEFORE UPDATE OR DELETE ON public.evaluation_schemes
FOR EACH ROW EXECUTE FUNCTION public.guard_evaluation_scheme();
--> statement-breakpoint
CREATE FUNCTION public.guard_evaluation_component() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE selected_course uuid; frozen timestamptz;
BEGIN
  selected_course := CASE WHEN TG_OP = 'DELETE' THEN OLD.course_id ELSE NEW.course_id END;
  SELECT frozen_at INTO frozen FROM public.evaluation_schemes WHERE course_id = selected_course FOR UPDATE;
  IF frozen IS NOT NULL OR (TG_OP = 'UPDATE' AND (NEW.id, NEW.course_id) IS DISTINCT FROM (OLD.id, OLD.course_id)) THEN
    RAISE EXCEPTION 'Evaluation components are frozen after the first grade' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evaluation_component_guard BEFORE INSERT OR UPDATE OR DELETE ON public.evaluation_components
FOR EACH ROW EXECUTE FUNCTION public.guard_evaluation_component();
--> statement-breakpoint
CREATE FUNCTION public.check_evaluation_weights() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE selected_course uuid; component_count integer; total bigint;
BEGIN
  selected_course := CASE WHEN TG_OP = 'DELETE' THEN OLD.course_id ELSE NEW.course_id END;
  SELECT count(*), sum(weight_hundredths) INTO component_count, total FROM public.evaluation_components WHERE course_id = selected_course;
  IF component_count NOT BETWEEN 1 AND 100 OR total IS DISTINCT FROM 10000::bigint THEN
    RAISE EXCEPTION 'Evaluation weights must sum exactly 100 percent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER evaluation_weights_check AFTER INSERT OR UPDATE OR DELETE ON public.evaluation_components
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_evaluation_weights();
--> statement-breakpoint
CREATE FUNCTION public.guard_evaluation_grade() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE frozen timestamptz; total bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Grades retain historical evidence' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.course_id, NEW.component_id, NEW.participant_id, NEW.registration_id)
    IS DISTINCT FROM (OLD.course_id, OLD.component_id, OLD.participant_id, OLD.registration_id)
    OR NEW.revision <> OLD.revision + 1) THEN
    RAISE EXCEPTION 'Grade identity is immutable and revisions advance by one' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pre_registrations r WHERE r.id = NEW.registration_id
    AND r.course_id = NEW.course_id AND r.participant_id = NEW.participant_id) THEN
    RAISE EXCEPTION 'Grade registration must match its course and participant' USING ERRCODE = '23514';
  END IF;
  SELECT frozen_at INTO frozen FROM public.evaluation_schemes WHERE course_id = NEW.course_id FOR UPDATE;
  SELECT sum(weight_hundredths) INTO total FROM public.evaluation_components WHERE course_id = NEW.course_id;
  IF total IS DISTINCT FROM 10000::bigint THEN
    RAISE EXCEPTION 'A complete evaluation scheme is required before grading' USING ERRCODE = '23514';
  END IF;
  IF frozen IS NULL THEN
    UPDATE public.evaluation_schemes SET frozen_at = NEW.recorded_at, revision = revision + 1,
      updated_by = NEW.recorded_by, updated_at = NEW.recorded_at WHERE course_id = NEW.course_id;
    INSERT INTO public.audit_events (actor_id, entity_type, entity_id, action, metadata)
      VALUES (NEW.recorded_by, 'COURSE', NEW.course_id, 'EVALUATION_SCHEME_FROZEN', jsonb_build_object('componentId', NEW.component_id));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evaluation_grade_guard BEFORE INSERT OR UPDATE OR DELETE ON public.evaluation_grades
FOR EACH ROW EXECUTE FUNCTION public.guard_evaluation_grade();
--> statement-breakpoint
CREATE FUNCTION public.record_evaluation_grade() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE final_value integer;
BEGIN
  SELECT CASE WHEN count(g.component_id) = count(*) THEN
    round(sum(g.score_hundredths::numeric * c.weight_hundredths) / 10000)::integer ELSE NULL END
    INTO final_value FROM public.evaluation_components c LEFT JOIN public.evaluation_grades g
    ON g.course_id = c.course_id AND g.component_id = c.id AND g.participant_id = NEW.participant_id
    WHERE c.course_id = NEW.course_id;
  INSERT INTO public.evaluation_results (course_id, participant_id, final_hundredths, updated_at)
    VALUES (NEW.course_id, NEW.participant_id, final_value, NEW.recorded_at)
    ON CONFLICT (course_id, participant_id) DO UPDATE SET final_hundredths = EXCLUDED.final_hundredths, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.audit_events (actor_id, entity_type, entity_id, action, metadata)
    VALUES (NEW.recorded_by, 'COURSE', NEW.course_id, 'EVALUATION_GRADE_RECORDED',
      jsonb_build_object('participantId', NEW.participant_id, 'registrationId', NEW.registration_id,
        'componentId', NEW.component_id, 'fromHundredths', CASE WHEN TG_OP = 'UPDATE' THEN OLD.score_hundredths ELSE NULL END,
        'toHundredths', NEW.score_hundredths, 'revision', NEW.revision));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evaluation_grade_record AFTER INSERT OR UPDATE ON public.evaluation_grades
FOR EACH ROW EXECUTE FUNCTION public.record_evaluation_grade();
--> statement-breakpoint
CREATE FUNCTION public.guard_evaluation_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation command receipts are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evaluation_receipt_guard BEFORE UPDATE OR DELETE ON public.evaluation_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_evaluation_receipt();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_evaluation_scheme(), public.guard_evaluation_component(),
  public.check_evaluation_weights(), public.guard_evaluation_grade(), public.record_evaluation_grade(), public.guard_evaluation_receipt()
  FROM PUBLIC, anon, authenticated, service_role;
