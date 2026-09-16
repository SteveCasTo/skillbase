CREATE TYPE "public"."course_level" AS ENUM('BASIC', 'INTERMEDIATE', 'ADVANCED');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('STUDENT', 'EXTERNAL');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_action_not_blank_check" CHECK (length(btrim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_not_blank_check" CHECK (length(btrim("audit_events"."entity_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "course_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"participant_type" "participant_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'BOB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_prices_amount_check" CHECK ("course_prices"."amount" >= 0),
	CONSTRAINT "course_prices_currency_check" CHECK ("course_prices"."currency" = 'BOB')
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"level" "course_level" NOT NULL,
	"total_hours" integer NOT NULL,
	"schedule" text NOT NULL,
	"conditions" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"registration_start_at" timestamp with time zone,
	"registration_end_at" timestamp with time zone,
	"minimum_grade" integer NOT NULL,
	"status" "course_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_name_not_blank_check" CHECK (length(btrim("courses"."name")) > 0),
	CONSTRAINT "courses_description_not_blank_check" CHECK (length(btrim("courses"."description")) > 0),
	CONSTRAINT "courses_schedule_not_blank_check" CHECK (length(btrim("courses"."schedule")) > 0),
	CONSTRAINT "courses_conditions_not_blank_check" CHECK (length(btrim("courses"."conditions")) > 0),
	CONSTRAINT "courses_slug_format_check" CHECK ("courses"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "courses_total_hours_check" CHECK ("courses"."total_hours" > 0),
	CONSTRAINT "courses_minimum_grade_check" CHECK ("courses"."minimum_grade" between 0 and 100),
	CONSTRAINT "courses_dates_check" CHECK ("courses"."starts_at" < "courses"."ends_at"),
	CONSTRAINT "courses_registration_window_check" CHECK (("courses"."registration_start_at" is null and "courses"."registration_end_at" is null) or ("courses"."registration_start_at" is not null and "courses"."registration_end_at" is not null and "courses"."registration_start_at" < "courses"."registration_end_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prices" ADD CONSTRAINT "course_prices_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "course_prices_course_participant_unique" ON "course_prices" USING btree ("course_id","participant_type");--> statement-breakpoint
CREATE INDEX "course_prices_course_id_idx" ON "course_prices" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_slug_unique" ON "courses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "courses_status_idx" ON "courses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "courses_status_created_at_idx" ON "courses" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "course_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "courses", "course_prices", "audit_events" FROM "anon", "authenticated", "service_role";
