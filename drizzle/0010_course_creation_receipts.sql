ALTER TABLE "courses" ADD COLUMN "create_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "create_request_key" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "create_fingerprint" text;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_create_actor_id_users_id_fk" FOREIGN KEY ("create_actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_create_request_unique" ON "courses" USING btree ("create_actor_id","create_request_key");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_create_request_check" CHECK (("courses"."create_actor_id" is null and "courses"."create_request_key" is null and "courses"."create_fingerprint" is null) or ("courses"."create_actor_id" is not null and "courses"."create_request_key" is not null and "courses"."create_fingerprint" is not null and "courses"."create_fingerprint" ~ '^[0-9a-f]{64}$'));