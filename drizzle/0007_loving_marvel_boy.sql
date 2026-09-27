CREATE TYPE "public"."group_status" AS ENUM('PLANNED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"course_type_revision_id" uuid NOT NULL,
	"capacity" integer NOT NULL,
	"status" "group_status" DEFAULT 'PLANNED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_capacity_check" CHECK ("groups"."capacity" > 0),
	CONSTRAINT "groups_dates_check" CHECK ("groups"."starts_at" < "groups"."ends_at")
 );
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_id_course_type_revision_id_unique" UNIQUE ("id", "course_type_revision_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_course_revision_fk" FOREIGN KEY ("course_id", "course_type_revision_id") REFERENCES "public"."courses"("id", "course_type_revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_course_id_idx" ON "groups" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "groups_course_type_revision_id_idx" ON "groups" USING btree ("course_type_revision_id");--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "groups" FROM anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL ON TYPE "group_status" FROM anon, authenticated, service_role;--> statement-breakpoint
-- A course with groups must retain its calendar and immutable format snapshot.
CREATE FUNCTION public.protect_group_course_plan() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (OLD.starts_at, OLD.ends_at, OLD.weekdays_mask, OLD.course_type_revision_id)
     IS DISTINCT FROM (NEW.starts_at, NEW.ends_at, NEW.weekdays_mask, NEW.course_type_revision_id)
     AND EXISTS (SELECT 1 FROM public.groups WHERE course_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot change the calendar or format of a course with groups';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER protect_group_course_plan BEFORE UPDATE ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.protect_group_course_plan();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_group_course_plan() FROM PUBLIC, anon, authenticated, service_role;
