CREATE TABLE "academic_closure_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "academic_closure_receipts_check" CHECK ("academic_closure_receipts"."fingerprint" ~ '^[0-9a-f]{64}$' and jsonb_typeof("academic_closure_receipts"."result") = 'object')
);
--> statement-breakpoint
ALTER TABLE "academic_closure_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "academic_closure_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"closed_at" timestamp (3) with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"report" jsonb NOT NULL,
	CONSTRAINT "academic_closure_versions_group_version_unique" UNIQUE("group_id","version"),
	CONSTRAINT "academic_closure_versions_check" CHECK ("academic_closure_versions"."version" > 0 and char_length(btrim("academic_closure_versions"."actor_name")) > 0 and jsonb_typeof("academic_closure_versions"."report") = 'object')
);
--> statement-breakpoint
ALTER TABLE "academic_closure_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "academic_group_reopenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"reopened_at" timestamp (3) with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "academic_group_reopenings_reason_check" CHECK (char_length(btrim("academic_group_reopenings"."reason")) between 1 and 500 and "academic_group_reopenings"."reason" !~ '[[:cntrl:]]' and char_length(btrim("academic_group_reopenings"."actor_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "academic_group_reopenings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "academic_group_states" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"last_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "academic_group_states_revision_check" CHECK ("academic_group_states"."revision" >= 0 and "academic_group_states"."last_version" >= 0 and (not "academic_group_states"."closed" or "academic_group_states"."last_version" > 0))
);
--> statement-breakpoint
ALTER TABLE "academic_group_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "academic_closure_receipts" ADD CONSTRAINT "academic_closure_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_closure_versions" ADD CONSTRAINT "academic_closure_versions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_closure_versions" ADD CONSTRAINT "academic_closure_versions_course_group_fk" FOREIGN KEY ("course_id","group_id") REFERENCES "public"."groups"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_group_reopenings" ADD CONSTRAINT "academic_group_reopenings_version_id_academic_closure_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."academic_closure_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_group_reopenings" ADD CONSTRAINT "academic_group_reopenings_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_group_states" ADD CONSTRAINT "academic_group_states_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_closure_receipts_actor_key_unique" ON "academic_closure_receipts" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE INDEX "academic_closure_versions_actor_idx" ON "academic_closure_versions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "academic_closure_versions_course_group_idx" ON "academic_closure_versions" USING btree ("course_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_group_reopenings_version_unique" ON "academic_group_reopenings" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "academic_group_reopenings_actor_idx" ON "academic_group_reopenings" USING btree ("actor_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.academic_group_states, public.academic_closure_versions,
  public.academic_group_reopenings, public.academic_closure_receipts
  FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.guard_academic_closure_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Academic closure history is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER academic_closure_version_immutable BEFORE UPDATE OR DELETE ON public.academic_closure_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_academic_closure_history();
--> statement-breakpoint
CREATE TRIGGER academic_reopening_immutable BEFORE UPDATE OR DELETE ON public.academic_group_reopenings
FOR EACH ROW EXECUTE FUNCTION public.guard_academic_closure_history();
--> statement-breakpoint
CREATE TRIGGER academic_closure_receipt_immutable BEFORE UPDATE OR DELETE ON public.academic_closure_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_academic_closure_history();
--> statement-breakpoint
CREATE FUNCTION public.guard_closed_academic_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE selected_group uuid; selected_registration uuid; selected_session uuid;
BEGIN
  -- Same gate as repository writes, including financial membership chronology.
  -- This is defense in depth for alternate server adapters, not a public RPC.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260915, 3);
  IF TG_TABLE_NAME = 'evaluation_grades' THEN
    selected_registration := CASE WHEN TG_OP = 'DELETE' THEN OLD.registration_id ELSE NEW.registration_id END;
    SELECT group_id INTO selected_group FROM public.pre_registrations WHERE id = selected_registration;
  ELSIF TG_TABLE_NAME = 'group_sessions' THEN
    selected_group := CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END;
  ELSE
    selected_session := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
    SELECT group_id INTO selected_group FROM public.group_sessions WHERE id = selected_session;
  END IF;
  PERFORM 1 FROM public.groups WHERE id = selected_group FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.academic_group_states WHERE group_id = selected_group AND closed) THEN
    RAISE EXCEPTION 'Academic group is closed; reopen before changing evidence' USING ERRCODE = '23514';
  END IF;
  -- Updates cannot move an old piece of closed evidence to an open group either.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'evaluation_grades' THEN
      SELECT group_id INTO selected_group FROM public.pre_registrations WHERE id = OLD.registration_id;
    ELSIF TG_TABLE_NAME = 'group_sessions' THEN
      selected_group := OLD.group_id;
    ELSE
      SELECT group_id INTO selected_group FROM public.group_sessions WHERE id = OLD.session_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.academic_group_states WHERE group_id = selected_group AND closed) THEN
      RAISE EXCEPTION 'Closed academic evidence cannot be moved' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER academic_closed_grade_guard BEFORE INSERT OR UPDATE OR DELETE ON public.evaluation_grades
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_academic_evidence();
--> statement-breakpoint
CREATE TRIGGER academic_closed_participant_attendance_guard BEFORE INSERT OR UPDATE OR DELETE ON public.participant_attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_academic_evidence();
--> statement-breakpoint
CREATE TRIGGER academic_closed_instructor_attendance_guard BEFORE INSERT OR UPDATE OR DELETE ON public.instructor_attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_academic_evidence();
--> statement-breakpoint
CREATE TRIGGER academic_closed_roster_guard BEFORE INSERT OR UPDATE OR DELETE ON public.session_roster
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_academic_evidence();
--> statement-breakpoint
CREATE TRIGGER academic_closed_session_guard BEFORE INSERT OR UPDATE OR DELETE ON public.group_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_academic_evidence();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_academic_closure_history(), public.guard_closed_academic_evidence()
FROM PUBLIC, anon, authenticated, service_role;
