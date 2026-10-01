CREATE TABLE "auth_google_link_requests" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_google_link_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_primary_provider" text DEFAULT 'GOOGLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_google_link_requests" ADD CONSTRAINT "auth_google_link_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_google_link_requests_user_idx" ON "auth_google_link_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_google_link_requests_expiry_idx" ON "auth_google_link_requests" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_primary_provider_check" CHECK ("users"."auth_primary_provider" in ('GOOGLE', 'EMAIL'));
--> statement-breakpoint
REVOKE ALL ON TABLE "auth_google_link_requests" FROM anon, authenticated, service_role;
