ALTER TABLE "course_prices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "course_prices";--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT "courses_total_hours_check";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "total_hours";
