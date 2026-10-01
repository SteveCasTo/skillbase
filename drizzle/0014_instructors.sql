CREATE TABLE "instructor_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructor_profiles_first_name_check" CHECK (char_length("instructor_profiles"."first_name") between 1 and 100 and "instructor_profiles"."first_name" = btrim("instructor_profiles"."first_name") and "instructor_profiles"."first_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "instructor_profiles_last_name_check" CHECK (char_length("instructor_profiles"."last_name") between 1 and 150 and "instructor_profiles"."last_name" = btrim("instructor_profiles"."last_name") and "instructor_profiles"."last_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "instructor_profiles_phone_check" CHECK ("instructor_profiles"."phone" is null or (char_length("instructor_profiles"."phone") between 1 and 32 and "instructor_profiles"."phone" = btrim("instructor_profiles"."phone") and "instructor_profiles"."phone" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
ALTER TABLE "instructor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_instructor_profiles_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courses_instructor_id_idx" ON "courses" USING btree ("instructor_id");
--> statement-breakpoint
REVOKE ALL ON TABLE "instructor_profiles" FROM anon, authenticated;
--> statement-breakpoint
CREATE TABLE "course_instructor_history" (
  "course_id" uuid NOT NULL,
  "instructor_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "first_assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_instructor_history_course_id_instructor_id_pk" PRIMARY KEY("course_id","instructor_id")
);
--> statement-breakpoint
ALTER TABLE "course_instructor_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "course_instructor_history" ADD CONSTRAINT "course_instructor_history_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "course_instructor_history" ADD CONSTRAINT "course_instructor_history_profile_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructor_profiles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "course_instructor_history" ADD CONSTRAINT "course_instructor_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "course_instructor_history_instructor_idx" ON "course_instructor_history" USING btree ("instructor_id");
--> statement-breakpoint
CREATE INDEX "course_instructor_history_actor_idx" ON "course_instructor_history" USING btree ("actor_id");
--> statement-breakpoint
REVOKE ALL ON TABLE "course_instructor_history" FROM anon, authenticated;
