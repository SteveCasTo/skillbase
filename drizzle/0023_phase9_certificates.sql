CREATE TABLE "certificate_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"path" text NOT NULL,
	"purpose" text NOT NULL,
	"sha256" text NOT NULL,
	"certificate_revision" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "certificate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "certificate_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "certificate_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"configuration" jsonb NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "certificate_settings_singleton" CHECK ("certificate_settings"."id" = 1 and "certificate_settings"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "certificate_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_credential_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp (3) with time zone,
	"issued_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"reason" text,
	"unsigned_path" text,
	"signed_path" text,
	"signed_sha256" text,
	"reviewed" boolean DEFAULT false NOT NULL,
	"replacement_for_id" uuid,
	"replaced_by_id" uuid,
	CONSTRAINT "certificates_values_check" CHECK ("certificates"."type" in ('APPROVAL','INSTRUCTOR') and "certificates"."state" in ('pending','generated','awaiting_signature','issued','revoked','replaced') and "certificates"."version" > 0 and "certificates"."revision" >= 0 and "certificates"."public_credential_id" ~ '^[A-Za-z0-9_-]{32}$' and ("certificates"."signed_sha256" is null or "certificates"."signed_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "certificates_issued_check" CHECK ("certificates"."state" not in ('issued','revoked','replaced') or ("certificates"."signed_path" is not null and "certificates"."signed_sha256" is not null and "certificates"."issued_at" is not null and "certificates"."reviewed"))
);
--> statement-breakpoint
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certificate_artifacts" ADD CONSTRAINT "certificate_artifacts_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_artifacts" ADD CONSTRAINT "certificate_artifacts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_events" ADD CONSTRAINT "certificate_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_receipts" ADD CONSTRAINT "certificate_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_settings" ADD CONSTRAINT "certificate_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_version_id_academic_closure_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."academic_closure_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_group_fk" FOREIGN KEY ("course_id","group_id") REFERENCES "public"."groups"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_replacement_for_fk" FOREIGN KEY ("replacement_for_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_replaced_by_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_artifacts_path_unique" ON "certificate_artifacts" USING btree ("path");--> statement-breakpoint
CREATE INDEX "certificate_artifacts_certificate_idx" ON "certificate_artifacts" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "certificate_artifacts_actor_idx" ON "certificate_artifacts" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "certificate_artifacts_cleanup_idx" ON "certificate_artifacts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "certificate_events_certificate_idx" ON "certificate_events" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "certificate_events_actor_idx" ON "certificate_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_receipts_actor_key_unique" ON "certificate_receipts" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE INDEX "certificate_settings_actor_idx" ON "certificate_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_public_id_unique" ON "certificates" USING btree ("public_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_one_active_unique" ON "certificates" USING btree ("course_id","type","recipient_id") WHERE "certificates"."state" = 'issued';--> statement-breakpoint
CREATE INDEX "certificates_group_idx" ON "certificates" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "certificates_version_idx" ON "certificates" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "certificates_instructor_idx" ON "certificates" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "certificates_actor_idx" ON "certificates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "certificates_replacement_idx" ON "certificates" USING btree ("replacement_for_id");--> statement-breakpoint
CREATE INDEX "certificates_replaced_idx" ON "certificates" USING btree ("replaced_by_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.certificates, public.certificate_settings, public.certificate_artifacts, public.certificate_events, public.certificate_receipts FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.certificate_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'Certificate history is append-only' USING ERRCODE = '23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER certificate_events_immutable BEFORE UPDATE OR DELETE ON public.certificate_events FOR EACH ROW EXECUTE FUNCTION public.certificate_append_only();
--> statement-breakpoint
CREATE TRIGGER certificate_receipts_immutable BEFORE UPDATE OR DELETE ON public.certificate_receipts FOR EACH ROW EXECUTE FUNCTION public.certificate_append_only();
--> statement-breakpoint
CREATE FUNCTION public.certificate_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE source public.academic_closure_versions; official public.academic_group_states;
BEGIN
  PERFORM pg_advisory_xact_lock(20260915, 3);
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificates cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['state','revision','generated_at','issued_at','revoked_at','reason','unsigned_path','signed_path','signed_sha256','reviewed','replaced_by_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','generated_at','issued_at','revoked_at','reason','unsigned_path','signed_path','signed_sha256','reviewed','replaced_by_id']) THEN RAISE EXCEPTION 'Certificate metadata is frozen' USING ERRCODE = '23514'; END IF;
    IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Certificate revision must advance' USING ERRCODE = '23514'; END IF;
    IF OLD.state IN ('issued','revoked','replaced') AND (NEW.unsigned_path IS DISTINCT FROM OLD.unsigned_path OR NEW.signed_path IS DISTINCT FROM OLD.signed_path OR NEW.signed_sha256 IS DISTINCT FROM OLD.signed_sha256 OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.generated_at IS DISTINCT FROM OLD.generated_at OR NEW.reviewed IS DISTINCT FROM OLD.reviewed) THEN RAISE EXCEPTION 'Issued artifacts are immutable' USING ERRCODE = '23514'; END IF;
    IF OLD.state = 'replaced' OR (OLD.state = 'revoked' AND NEW.state <> 'replaced') OR (OLD.state = 'issued' AND NEW.state NOT IN ('revoked','replaced')) THEN RAISE EXCEPTION 'Terminal certificate transition denied' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.state IN ('generated','awaiting_signature','issued')) THEN
    SELECT * INTO source FROM public.academic_closure_versions WHERE id = NEW.version_id AND group_id = NEW.group_id AND course_id = NEW.course_id AND version = NEW.version;
    SELECT * INTO official FROM public.academic_group_states WHERE group_id = NEW.group_id;
    IF source.id IS NULL OR NOT coalesce(official.closed,false) OR official.last_version <> NEW.version THEN RAISE EXCEPTION 'Certificate requires current official closed version' USING ERRCODE = '23514'; END IF;
    IF source.report->>'instructorId' IS DISTINCT FROM NEW.instructor_id::text THEN RAISE EXCEPTION 'Certificate instructor must match closure' USING ERRCODE = '23514'; END IF;
    IF NEW.type = 'INSTRUCTOR' AND NEW.recipient_id <> NEW.instructor_id THEN RAISE EXCEPTION 'Instructor recipient mismatch' USING ERRCODE = '23514'; END IF;
    IF NEW.type = 'APPROVAL' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(source.report->'participants') p WHERE p->>'participantId' = NEW.recipient_id::text AND p->>'membershipStatus' = 'INSCRITO' AND p->>'academicallyPassed' = 'true') THEN RAISE EXCEPTION 'Certificate recipient not eligible in official snapshot' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.state IN ('revoked','replaced') AND (NEW.revoked_at IS NULL OR length(btrim(coalesce(NEW.reason,''))) = 0) THEN RAISE EXCEPTION 'Revocation/replacement requires reason and date' USING ERRCODE = '23514'; END IF;
  IF NEW.state = 'replaced' AND NEW.replaced_by_id IS NULL THEN RAISE EXCEPTION 'Replacement link required' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER certificate_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.certificate_record_guard();
--> statement-breakpoint
CREATE FUNCTION public.certificate_artifact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Artifact evidence cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR OLD.status IN ('attached','cleaned') OR NOT ((OLD.status = 'reserved' AND NEW.status IN ('attached','cleanup_pending')) OR (OLD.status = 'cleanup_pending' AND NEW.status = 'cleaned')) THEN RAISE EXCEPTION 'Artifact evidence is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER certificate_artifact_guard BEFORE UPDATE OR DELETE ON public.certificate_artifacts FOR EACH ROW EXECUTE FUNCTION public.certificate_artifact_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.certificate_append_only(), public.certificate_record_guard(), public.certificate_artifact_guard() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
-- Add only the dedicated private bucket; never rewrite an existing bucket.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'certificate-documents' AND public) THEN
    RAISE EXCEPTION 'Certificate bucket collision: public bucket is forbidden';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificate-documents', 'certificate-documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Restrictive policy cannot grant access; it also defeats any unrelated broad
-- permissive policy for this bucket. Server service-role Storage bypasses RLS.
CREATE POLICY certificate_objects_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'certificate-documents') WITH CHECK (bucket_id <> 'certificate-documents');
