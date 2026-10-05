CREATE TYPE "public"."attendance_state" AS ENUM('PRESENT', 'ABSENT', 'EXCUSED');--> statement-breakpoint
CREATE TABLE "attendance_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_receipts_fingerprint_check" CHECK ("attendance_command_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "attendance_command_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"consecutive_absence_limit" integer DEFAULT 3 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_singleton_check" CHECK ("attendance_settings"."id" = 1),
	CONSTRAINT "attendance_settings_count_check" CHECK ("attendance_settings"."consecutive_absence_limit" > 0 and "attendance_settings"."revision" > 0 and ("attendance_settings"."revision" = 1 or "attendance_settings"."updated_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "attendance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"course_type_revision_id" uuid NOT NULL,
	"ordinal" integer,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"administrative_review_required" boolean DEFAULT false NOT NULL,
	"roster_reviewed_at" timestamp (3) with time zone,
	"replacement_for_session_id" uuid,
	"cancelled_at" timestamp (3) with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_sessions_interval_check" CHECK ("group_sessions"."starts_at" < "group_sessions"."ends_at" and ("group_sessions"."starts_at" at time zone 'America/La_Paz')::date = ("group_sessions"."ends_at" at time zone 'America/La_Paz')::date and "group_sessions"."revision" > 0),
	CONSTRAINT "group_sessions_source_check" CHECK (("group_sessions"."ordinal" is not null and "group_sessions"."ordinal" > 0 and "group_sessions"."replacement_for_session_id" is null) or ("group_sessions"."ordinal" is null and "group_sessions"."replacement_for_session_id" is not null and "group_sessions"."replacement_for_session_id" <> "group_sessions"."id")),
	CONSTRAINT "group_sessions_cancel_check" CHECK (("group_sessions"."cancelled_at" is null and "group_sessions"."cancelled_by" is null and "group_sessions"."cancellation_reason" is null) or ("group_sessions"."cancelled_at" is not null and "group_sessions"."cancelled_by" is not null and char_length(coalesce("group_sessions"."cancellation_reason", '')) <= 500))
);
--> statement-breakpoint
ALTER TABLE "group_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instructor_attendance" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"instructor_id" uuid NOT NULL,
	"status" "attendance_state" NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instructor_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participant_attendance" (
	"session_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"status" "attendance_state" NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "participant_attendance_session_id_registration_id_pk" PRIMARY KEY("session_id","registration_id")
);
--> statement-breakpoint
ALTER TABLE "participant_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session_roster" (
	"session_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"established_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	CONSTRAINT "session_roster_session_id_registration_id_pk" PRIMARY KEY("session_id","registration_id")
);
--> statement-breakpoint
ALTER TABLE "session_roster" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_command_receipts" ADD CONSTRAINT "attendance_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sessions" ADD CONSTRAINT "group_sessions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sessions" ADD CONSTRAINT "group_sessions_course_type_revision_id_course_type_revisions_id_fk" FOREIGN KEY ("course_type_revision_id") REFERENCES "public"."course_type_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sessions" ADD CONSTRAINT "group_sessions_replacement_for_session_id_group_sessions_id_fk" FOREIGN KEY ("replacement_for_session_id") REFERENCES "public"."group_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sessions" ADD CONSTRAINT "group_sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_attendance" ADD CONSTRAINT "instructor_attendance_session_id_group_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."group_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_attendance" ADD CONSTRAINT "instructor_attendance_instructor_id_instructor_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_attendance" ADD CONSTRAINT "instructor_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_attendance" ADD CONSTRAINT "participant_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_attendance" ADD CONSTRAINT "participant_attendance_session_id_registration_id_session_roster_session_id_registration_id_fk" FOREIGN KEY ("session_id","registration_id") REFERENCES "public"."session_roster"("session_id","registration_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_roster" ADD CONSTRAINT "session_roster_session_id_group_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."group_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_roster" ADD CONSTRAINT "session_roster_registration_id_pre_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."pre_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_roster" ADD CONSTRAINT "session_roster_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_receipts_actor_key_unique" ON "attendance_command_receipts" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE INDEX "attendance_settings_actor_idx" ON "attendance_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "group_sessions_original_unique" ON "group_sessions" USING btree ("group_id","ordinal") WHERE "group_sessions"."ordinal" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "group_sessions_active_replacement_unique" ON "group_sessions" USING btree ("replacement_for_session_id") WHERE "group_sessions"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "group_sessions_group_calendar_idx" ON "group_sessions" USING btree ("group_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "group_sessions_revision_idx" ON "group_sessions" USING btree ("course_type_revision_id");--> statement-breakpoint
CREATE INDEX "group_sessions_cancelled_actor_idx" ON "group_sessions" USING btree ("cancelled_by");--> statement-breakpoint
CREATE INDEX "group_sessions_replacement_idx" ON "group_sessions" USING btree ("replacement_for_session_id");--> statement-breakpoint
CREATE INDEX "instructor_attendance_instructor_idx" ON "instructor_attendance" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_attendance_actor_idx" ON "instructor_attendance" USING btree ("marked_by");--> statement-breakpoint
CREATE INDEX "participant_attendance_registration_idx" ON "participant_attendance" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "participant_attendance_actor_idx" ON "participant_attendance" USING btree ("marked_by");--> statement-breakpoint
CREATE INDEX "session_roster_registration_idx" ON "session_roster" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "session_roster_review_actor_idx" ON "session_roster" USING btree ("reviewed_by");
--> statement-breakpoint
REVOKE ALL ON TABLE public.attendance_settings, public.group_sessions, public.session_roster,
  public.participant_attendance, public.instructor_attendance, public.attendance_command_receipts
  FROM anon, authenticated, service_role;
--> statement-breakpoint
INSERT INTO public.attendance_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION public.guard_group_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE source public.group_sessions; expected_minutes integer; group_revision uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.group_id, NEW.course_type_revision_id, NEW.ordinal, NEW.starts_at, NEW.ends_at, NEW.replacement_for_session_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.group_id, OLD.course_type_revision_id, OLD.ordinal, OLD.starts_at, OLD.ends_at, OLD.replacement_for_session_id, OLD.created_at) THEN
      RAISE EXCEPTION 'Session chronology is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at, NEW.cancelled_by, NEW.cancellation_reason)
      IS DISTINCT FROM (OLD.cancelled_at, OLD.cancelled_by, OLD.cancellation_reason) THEN
      RAISE EXCEPTION 'Cancelled sessions are retained' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT g.course_type_revision_id INTO group_revision FROM public.groups g WHERE g.id = NEW.group_id;
  SELECT r.session_minutes INTO expected_minutes FROM public.course_type_revisions r WHERE r.id = NEW.course_type_revision_id;
  IF group_revision IS DISTINCT FROM NEW.course_type_revision_id OR expected_minutes IS NULL
    OR NEW.ends_at - NEW.starts_at <> make_interval(mins => expected_minutes) THEN
    RAISE EXCEPTION 'Session must retain group format duration' USING ERRCODE = '23514';
  END IF;
  IF NEW.replacement_for_session_id IS NOT NULL THEN
    SELECT * INTO source FROM public.group_sessions s WHERE s.id = NEW.replacement_for_session_id FOR SHARE;
    IF source.id IS NULL OR source.cancelled_at IS NULL OR source.group_id <> NEW.group_id
      OR source.ends_at - source.starts_at <> NEW.ends_at - NEW.starts_at THEN
      RAISE EXCEPTION 'Replacement must reference a cancelled same-group session' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER group_session_guard BEFORE INSERT OR UPDATE ON public.group_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_group_session();
--> statement-breakpoint
CREATE FUNCTION public.guard_session_roster() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Session roster evidence is append-only' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pre_registrations r JOIN public.group_sessions s ON s.group_id = r.group_id
    WHERE r.id = NEW.registration_id AND s.id = NEW.session_id) THEN
    RAISE EXCEPTION 'Roster must belong to session group' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_roster_guard BEFORE INSERT OR UPDATE OR DELETE ON public.session_roster
FOR EACH ROW EXECUTE FUNCTION public.guard_session_roster();
--> statement-breakpoint
CREATE FUNCTION public.guard_attendance_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Attendance command receipts are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_receipt_guard BEFORE UPDATE OR DELETE ON public.attendance_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_receipt();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_group_session(), public.guard_session_roster(), public.guard_attendance_receipt()
  FROM PUBLIC, anon, authenticated, service_role;
