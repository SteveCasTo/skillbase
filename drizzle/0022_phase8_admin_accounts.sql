CREATE TABLE "admin_account_deletions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"requested_revision" timestamp (3) with time zone NOT NULL,
	"requested_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "admin_account_deletions_completion_check" CHECK ("admin_account_deletions"."completed_at" is null or "admin_account_deletions"."completed_at" >= "admin_account_deletions"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "admin_account_deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_account_deletions" ADD CONSTRAINT "admin_account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_account_deletions" ADD CONSTRAINT "admin_account_deletions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_account_deletions_actor_idx" ON "admin_account_deletions" USING btree ("actor_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.admin_account_deletions FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.guard_admin_account_deletion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.completed_at IS NOT NULL OR
     NEW.user_id IS DISTINCT FROM OLD.user_id OR
     NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
     NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id OR
     NEW.requested_revision IS DISTINCT FROM OLD.requested_revision OR
     NEW.requested_at IS DISTINCT FROM OLD.requested_at OR
     NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Admin deletion evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_admin_account_deletion() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER admin_account_deletion_guard BEFORE UPDATE OR DELETE ON public.admin_account_deletions
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_account_deletion();
