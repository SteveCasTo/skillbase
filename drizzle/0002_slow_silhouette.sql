CREATE TABLE "course_type_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_type_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"total_hours" integer NOT NULL,
	"student_amount" numeric(12, 2) NOT NULL,
	"external_amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_type_revisions_hours_check" CHECK ("course_type_revisions"."total_hours" > 0),
	CONSTRAINT "course_type_revisions_prices_check" CHECK ("course_type_revisions"."student_amount" >= 0 and "course_type_revisions"."external_amount" >= 0),
	CONSTRAINT "course_type_revisions_number_check" CHECK ("course_type_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "course_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_types_name_unique" UNIQUE("name"),
	CONSTRAINT "course_types_name_not_blank_check" CHECK (length(btrim("course_types"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "course_type_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "content_markdown" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "instructor_name" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "artwork" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_type_revisions" ADD CONSTRAINT "course_type_revisions_course_type_id_course_types_id_fk" FOREIGN KEY ("course_type_id") REFERENCES "public"."course_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_type_revisions_type_number_unique" ON "course_type_revisions" USING btree ("course_type_id","revision_number");--> statement-breakpoint
CREATE INDEX "course_type_revisions_type_idx" ON "course_type_revisions" USING btree ("course_type_id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_course_type_revision_id_course_type_revisions_id_fk" FOREIGN KEY ("course_type_revision_id") REFERENCES "public"."course_type_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courses_course_type_revision_idx" ON "courses" USING btree ("course_type_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_one_published_featured_unique" ON "courses" USING btree ("featured") WHERE "courses"."status" = 'PUBLISHED' and "courses"."featured" = true;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_featured_published_check" CHECK (not "courses"."featured" or "courses"."status" = 'PUBLISHED');
--> statement-breakpoint
-- Historical tuples are deliberately preserved, including non-standard prices. Fail closed
-- if a course has an incomplete pair instead of substituting a guessed default.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM courses c LEFT JOIN course_prices p ON p.course_id = c.id
    GROUP BY c.id HAVING count(p.id) <> 2 OR count(DISTINCT p.participant_type) <> 2
      OR bool_or(p.currency <> 'BOB')) THEN
    RAISE EXCEPTION 'Cannot migrate courses with incomplete or invalid prices';
  END IF;
END $$;
--> statement-breakpoint
CREATE TEMP TABLE migrated_course_terms ON COMMIT DROP AS
SELECT c.id course_id, c.total_hours, max(p.amount) FILTER (WHERE p.participant_type = 'STUDENT') student_amount,
  max(p.amount) FILTER (WHERE p.participant_type = 'EXTERNAL') external_amount,
  dense_rank() OVER (ORDER BY c.total_hours,
    max(p.amount) FILTER (WHERE p.participant_type = 'STUDENT'),
    max(p.amount) FILTER (WHERE p.participant_type = 'EXTERNAL')) term_number
FROM courses c JOIN course_prices p ON p.course_id = c.id GROUP BY c.id;
--> statement-breakpoint
INSERT INTO course_types (id, name)
SELECT gen_random_uuid(), 'Formato migrado ' || term_number FROM migrated_course_terms GROUP BY term_number;
--> statement-breakpoint
INSERT INTO course_type_revisions (course_type_id, revision_number, total_hours, student_amount, external_amount)
SELECT t.id, 1, m.total_hours, m.student_amount, m.external_amount
FROM (SELECT DISTINCT term_number, total_hours, student_amount, external_amount FROM migrated_course_terms) m
JOIN course_types t ON t.name = 'Formato migrado ' || m.term_number;
--> statement-breakpoint
UPDATE courses c SET course_type_revision_id = r.id
FROM migrated_course_terms m JOIN course_types t ON t.name = 'Formato migrado ' || m.term_number
JOIN course_type_revisions r ON r.course_type_id = t.id WHERE c.id = m.course_id;
--> statement-breakpoint
ALTER TABLE courses ALTER COLUMN course_type_revision_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE course_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE course_type_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE course_types, course_type_revisions FROM anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION reject_course_type_revision_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN RAISE EXCEPTION 'Course type revisions are immutable'; END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reject_course_type_revision_mutation() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER course_type_revisions_immutable BEFORE UPDATE OR DELETE ON course_type_revisions
FOR EACH ROW EXECUTE FUNCTION reject_course_type_revision_mutation();
