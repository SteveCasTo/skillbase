CREATE TABLE "instructor_account_deletions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instructor_account_deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instructor_account_deletions" ADD CONSTRAINT "instructor_account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_account_deletions" ADD CONSTRAINT "instructor_account_deletions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructor_account_deletions_actor_idx" ON "instructor_account_deletions" USING btree ("actor_id");
--> statement-breakpoint
REVOKE ALL ON TABLE "instructor_account_deletions" FROM anon, authenticated, service_role;
