CREATE TABLE "auth_attempt_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_attempt_buckets_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "auth_attempt_buckets_attempts_check" CHECK ("auth_attempt_buckets"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_attempt_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_google_identity_id" text;--> statement-breakpoint
CREATE INDEX "auth_attempt_buckets_expiry_idx" ON "auth_attempt_buckets" USING btree ("expires_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "auth_attempt_buckets" FROM anon, authenticated, service_role;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS private_auth;
--> statement-breakpoint
REVOKE ALL ON SCHEMA private_auth FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION private_auth.allow_invited_google_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  -- Only the trusted Auth hook role can execute this private function.
  -- Provider comes from Auth app_metadata, never editable user_metadata.
  -- Admin API creation bypasses signup hooks.
  IF event->'user'->'app_metadata'->>'provider' = 'google'
     AND EXISTS (
       SELECT 1 FROM public.users AS u
       WHERE u.email = lower(btrim(event->'user'->>'email'))
         AND u.status = 'INVITED' AND u.auth_user_id IS NULL
         AND EXISTS (SELECT 1 FROM public.user_roles AS r WHERE r.user_id = u.id)
     ) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Public signup is unavailable.'
  ));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private_auth.allow_invited_google_signup(jsonb) FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT USAGE ON SCHEMA private_auth TO supabase_auth_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private_auth.allow_invited_google_signup(jsonb) TO supabase_auth_admin;
