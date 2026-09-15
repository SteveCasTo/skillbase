CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_check" CHECK ("roles"."code" in ('ADMIN', 'INSTRUCTOR'))
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_pk" PRIMARY KEY("user_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"status" "user_status" DEFAULT 'INVITED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email")) and position('@' in "users"."email") > 1),
	CONSTRAINT "users_name_not_blank_check" CHECK (length(btrim("users"."name")) > 0),
	CONSTRAINT "users_invitation_link_check" CHECK (("users"."status" = 'INVITED' and "users"."auth_user_id" is null) or ("users"."status" <> 'INVITED' and "users"."auth_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_role_code_idx" ON "user_roles" USING btree ("role_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_unique" ON "users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");
--> statement-breakpoint
INSERT INTO "roles" ("code") VALUES ('ADMIN'), ('INSTRUCTOR');
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "users", "roles", "user_roles" FROM "anon", "authenticated", "service_role";
