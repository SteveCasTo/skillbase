-- Requires an explicitly reviewed operational reset of synthetic certificates.
-- Never converts or overwrites previously issued production credentials.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.certificates) THEN
    RAISE EXCEPTION 'Current certificate flow requires reviewed empty certificate dataset';
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX public.certificates_one_active_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX certificates_one_current_unique ON public.certificates(group_id, type, recipient_id);
--> statement-breakpoint
ALTER TABLE public.certificates DROP COLUMN replacement_for_id, DROP COLUMN replaced_by_id;
--> statement-breakpoint
ALTER TABLE public.certificates DROP CONSTRAINT certificates_values_check;
--> statement-breakpoint
ALTER TABLE public.certificates ADD CONSTRAINT certificates_values_check CHECK (type IN ('APPROVAL','INSTRUCTOR') AND state IN ('pending','generated','issued','revoked') AND version > 0 AND revision >= 0 AND public_credential_id ~ '^[A-Za-z0-9_-]{32}$' AND (signed_sha256 IS NULL OR signed_sha256 ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.certificate_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE source public.academic_closure_versions; official public.academic_group_states;
BEGIN
  PERFORM pg_advisory_xact_lock(20260915, 3);
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificates cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Certificate revision must advance' USING ERRCODE = '23514'; END IF;
    IF (to_jsonb(NEW) - ARRAY['state','revision','generated_at','issued_at','revoked_at','reason','unsigned_path','signed_path','signed_sha256','reviewed','public_credential_id','data','provenance','version_id','version','instructor_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','generated_at','issued_at','revoked_at','reason','unsigned_path','signed_path','signed_sha256','reviewed','public_credential_id','data','provenance','version_id','version','instructor_id']) THEN
      RAISE EXCEPTION 'Certificate identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'revoked' THEN RAISE EXCEPTION 'Revoked certificate is immutable' USING ERRCODE = '23514'; END IF;
    IF OLD.state = 'issued' THEN
      IF (to_jsonb(NEW) - ARRAY['state','revision','revoked_at','reason','signed_path','signed_sha256']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','revoked_at','reason','signed_path','signed_sha256']) OR NEW.state NOT IN ('issued','revoked') THEN
        RAISE EXCEPTION 'Signed metadata is frozen' USING ERRCODE = '23514';
      END IF;
      IF NEW.state = 'revoked' AND (NEW.signed_path IS DISTINCT FROM OLD.signed_path OR NEW.signed_sha256 IS DISTINCT FROM OLD.signed_sha256) THEN RAISE EXCEPTION 'Revocation cannot change artifacts' USING ERRCODE = '23514'; END IF;
    ELSIF NEW.public_credential_id IS DISTINCT FROM OLD.public_credential_id THEN
      IF NEW.state <> 'pending' OR NEW.unsigned_path IS NOT NULL OR NEW.signed_path IS NOT NULL OR NEW.generated_at IS NOT NULL OR NEW.issued_at IS NOT NULL THEN RAISE EXCEPTION 'Regeneration must reset unsigned draft' USING ERRCODE = '23514'; END IF;
    ELSIF NEW.data IS DISTINCT FROM OLD.data OR NEW.provenance IS DISTINCT FROM OLD.provenance OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id THEN
      RAISE EXCEPTION 'Metadata change requires new credential' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state <> 'revoked' THEN
    SELECT * INTO source FROM public.academic_closure_versions WHERE id = NEW.version_id AND group_id = NEW.group_id AND course_id = NEW.course_id AND version = NEW.version;
    SELECT * INTO official FROM public.academic_group_states WHERE group_id = NEW.group_id;
    IF source.id IS NULL OR NOT coalesce(official.closed,false) OR official.last_version <> NEW.version THEN RAISE EXCEPTION 'Certificate requires current official closed version' USING ERRCODE = '23514'; END IF;
    IF source.report->>'instructorId' IS DISTINCT FROM NEW.instructor_id::text THEN RAISE EXCEPTION 'Certificate instructor must match closure' USING ERRCODE = '23514'; END IF;
    IF NEW.type = 'INSTRUCTOR' AND NEW.recipient_id <> NEW.instructor_id THEN RAISE EXCEPTION 'Instructor recipient mismatch' USING ERRCODE = '23514'; END IF;
    IF NEW.type = 'APPROVAL' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(source.report->'participants') p WHERE p->>'participantId' = NEW.recipient_id::text AND p->>'membershipStatus' = 'INSCRITO' AND p->>'academicallyPassed' = 'true') THEN RAISE EXCEPTION 'Certificate recipient not eligible in official snapshot' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.data->>'publicCredentialId' IS DISTINCT FROM NEW.public_credential_id THEN RAISE EXCEPTION 'Credential metadata mismatch' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' AND (NEW.state <> 'pending' OR NEW.unsigned_path IS NOT NULL OR NEW.signed_path IS NOT NULL) THEN RAISE EXCEPTION 'Insert requires empty draft' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.unsigned_path IS DISTINCT FROM OLD.unsigned_path AND NEW.unsigned_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.certificate_artifacts a WHERE a.certificate_id = NEW.id AND a.path = NEW.unsigned_path AND a.purpose = 'UNSIGNED' AND a.status = 'reserved' AND a.certificate_revision = OLD.revision) THEN RAISE EXCEPTION 'Unsigned reservation required' USING ERRCODE = '23514'; END IF;
    IF (NEW.signed_path IS DISTINCT FROM OLD.signed_path OR NEW.signed_sha256 IS DISTINCT FROM OLD.signed_sha256) AND NOT EXISTS (SELECT 1 FROM public.certificate_artifacts a WHERE a.certificate_id = NEW.id AND a.path = NEW.signed_path AND a.sha256 = NEW.signed_sha256 AND a.purpose = 'SIGNED' AND a.status = 'reserved' AND a.certificate_revision = OLD.revision) THEN RAISE EXCEPTION 'Exact signed reservation required' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.state = 'revoked' AND (NEW.revoked_at IS NULL OR length(btrim(coalesce(NEW.reason,''))) = 0) THEN RAISE EXCEPTION 'Revocation requires reason and date' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.certificate_artifact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Artifact evidence cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR NOT ((OLD.status = 'reserved' AND NEW.status IN ('attached','cleanup_pending')) OR (OLD.status = 'attached' AND NEW.status = 'cleanup_pending') OR (OLD.status = 'cleanup_pending' AND NEW.status = 'cleaned')) THEN RAISE EXCEPTION 'Artifact evidence is immutable' USING ERRCODE = '23514'; END IF;
  IF OLD.status = 'attached' AND EXISTS (SELECT 1 FROM public.certificates c WHERE c.id = NEW.certificate_id AND (c.unsigned_path = NEW.path OR c.signed_path = NEW.path)) THEN RAISE EXCEPTION 'Current artifact cannot be cleaned' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
