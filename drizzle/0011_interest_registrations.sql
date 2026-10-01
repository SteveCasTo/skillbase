CREATE TYPE "public"."interest_registration_status" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "interest_registration_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "interest_registration_rate_limits_attempts_check" CHECK ("interest_registration_rate_limits"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "interest_registration_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interest_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"preferred_group_id" uuid,
	"status" "interest_registration_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_registrations_course_email_unique" UNIQUE("course_id","email"),
	CONSTRAINT "interest_registrations_first_name_check" CHECK (char_length("interest_registrations"."first_name") between 1 and 100 and "interest_registrations"."first_name" = btrim("interest_registrations"."first_name") and "interest_registrations"."first_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "interest_registrations_last_name_check" CHECK (char_length("interest_registrations"."last_name") between 1 and 150 and "interest_registrations"."last_name" = btrim("interest_registrations"."last_name") and "interest_registrations"."last_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "interest_registrations_email_check" CHECK ("interest_registrations"."email" = lower(btrim("interest_registrations"."email")) and char_length("interest_registrations"."email") between 3 and 254 and "interest_registrations"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and "interest_registrations"."email" !~ '[[:cntrl:]]'),
	CONSTRAINT "interest_registrations_phone_check" CHECK ("interest_registrations"."phone" is null or (char_length("interest_registrations"."phone") between 1 and 32 and "interest_registrations"."phone" = btrim("interest_registrations"."phone") and "interest_registrations"."phone" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
ALTER TABLE "interest_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_course_id_id_unique" UNIQUE("course_id","id");--> statement-breakpoint
ALTER TABLE "interest_registrations" ADD CONSTRAINT "interest_registrations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_registrations" ADD CONSTRAINT "interest_registrations_course_group_fk" FOREIGN KEY ("course_id","preferred_group_id") REFERENCES "public"."groups"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interest_registration_rate_limits_expiry_idx" ON "interest_registration_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "interest_registrations_course_status_created_idx" ON "interest_registrations" USING btree ("course_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "interest_registrations_course_preference_idx" ON "interest_registrations" USING btree ("course_id","preferred_group_id");--> statement-breakpoint
REVOKE ALL ON TABLE "interest_registrations", "interest_registration_rate_limits" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL ON TYPE "public"."interest_registration_status" FROM PUBLIC, anon, authenticated, service_role;
