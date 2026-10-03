CREATE TYPE "public"."pre_registration_state" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."registration_ledger_kind" AS ENUM('PAYMENT', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."registration_participant_type" AS ENUM('STUDENT', 'EXTERNAL', 'AUXILIARY');--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ci" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_ci_check" CHECK (char_length("participants"."ci") between 1 and 64 and "participants"."ci" = upper("participants"."ci") and "participants"."ci" !~ '[[:space:][:cntrl:]]'),
	CONSTRAINT "participants_first_name_check" CHECK (char_length("participants"."first_name") between 1 and 100 and "participants"."first_name" = btrim("participants"."first_name") and "participants"."first_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "participants_last_name_check" CHECK (char_length("participants"."last_name") between 1 and 150 and "participants"."last_name" = btrim("participants"."last_name") and "participants"."last_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "participants_email_check" CHECK ("participants"."email" = lower(btrim("participants"."email")) and char_length("participants"."email") between 3 and 254 and "participants"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and "participants"."email" !~ '[[:cntrl:]]'),
	CONSTRAINT "participants_phone_check" CHECK ("participants"."phone" is null or (char_length("participants"."phone") between 1 and 32 and "participants"."phone" = btrim("participants"."phone") and "participants"."phone" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pre_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"course_type_revision_id" uuid NOT NULL,
	"source_interest_id" uuid,
	"state" "pre_registration_state" DEFAULT 'ACTIVE' NOT NULL,
	"participant_type" "registration_participant_type" NOT NULL,
	"currency" text DEFAULT 'BOB' NOT NULL,
	"settings_revision" integer NOT NULL,
	"base_price_cents" numeric(12, 0) NOT NULL,
	"discount_percent" integer NOT NULL,
	"total_price_cents" numeric(12, 0) NOT NULL,
	"minimum_payment_percent" integer NOT NULL,
	"minimum_payment_cents" numeric(12, 0) NOT NULL,
	"first_day_exception" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"cancelled_at" timestamp (3) with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"cancellation_note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_registrations_price_check" CHECK ("pre_registrations"."currency" = 'BOB' and "pre_registrations"."settings_revision" > 0 and "pre_registrations"."base_price_cents" >= 0 and "pre_registrations"."discount_percent" between 0 and 100 and ("pre_registrations"."participant_type" = 'AUXILIARY' or "pre_registrations"."discount_percent" = 0) and "pre_registrations"."total_price_cents" = floor(("pre_registrations"."base_price_cents" * (100 - "pre_registrations"."discount_percent") + 50) / 100) and "pre_registrations"."minimum_payment_percent" between 1 and 100 and "pre_registrations"."minimum_payment_cents" = ceil("pre_registrations"."total_price_cents" * "pre_registrations"."minimum_payment_percent" / 100)),
	CONSTRAINT "pre_registrations_cancelled_check" CHECK (("pre_registrations"."state" = 'ACTIVE' and "pre_registrations"."cancelled_at" is null and "pre_registrations"."cancelled_by" is null and "pre_registrations"."cancellation_reason" is null and "pre_registrations"."cancellation_note" is null) or ("pre_registrations"."state" = 'CANCELLED' and "pre_registrations"."cancelled_at" is not null and "pre_registrations"."cancelled_by" is not null and "pre_registrations"."cancellation_reason" is not null and "pre_registrations"."cancellation_reason" in ('VOLUNTARY', 'GROUP_CANCELLED') and "pre_registrations"."cancellation_note" is not null and char_length(btrim("pre_registrations"."cancellation_note")) between 1 and 500 and "pre_registrations"."cancellation_note" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
ALTER TABLE "pre_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"operation" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_command_receipts_id_actor_unique" UNIQUE("id","actor_id"),
	CONSTRAINT "registration_command_receipts_fingerprint_check" CHECK ("registration_command_receipts"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "registration_command_receipts_operation_check" CHECK ("registration_command_receipts"."operation" in ('CREATE', 'PAYMENT', 'REFUND', 'CANCEL', 'TRANSFER', 'PARTICIPANT_UPDATE', 'SETTINGS_UPDATE', 'GROUP_CANCEL')),
	CONSTRAINT "registration_command_receipts_result_check" CHECK (jsonb_typeof("registration_command_receipts"."result") = 'object')
);
--> statement-breakpoint
ALTER TABLE "registration_command_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"command_receipt_id" uuid NOT NULL,
	"kind" "registration_ledger_kind" NOT NULL,
	"amount_cents" numeric(12, 0) NOT NULL,
	"effective_date" date NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_ledger_amount_check" CHECK ("registration_ledger"."amount_cents" > 0),
	CONSTRAINT "registration_ledger_date_check" CHECK ("registration_ledger"."effective_date" <= ("registration_ledger"."recorded_at" at time zone 'America/La_Paz')::date),
	CONSTRAINT "registration_ledger_reason_check" CHECK (char_length(btrim("registration_ledger"."reason")) between 1 and 500 and "registration_ledger"."reason" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "registration_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"minimum_payment_percent" integer DEFAULT 25 NOT NULL,
	"auxiliary_discount_percent" integer DEFAULT 50 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_settings_singleton_check" CHECK ("registration_settings"."id" = 1),
	CONSTRAINT "registration_settings_percent_check" CHECK ("registration_settings"."minimum_payment_percent" between 1 and 100 and "registration_settings"."auxiliary_discount_percent" between 0 and 100),
	CONSTRAINT "registration_settings_revision_check" CHECK ("registration_settings"."revision" > 0 and ("registration_settings"."revision" = 1 or "registration_settings"."updated_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "registration_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_course_group_fk" FOREIGN KEY ("course_id","group_id") REFERENCES "public"."groups"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_course_revision_fk" FOREIGN KEY ("course_id","course_type_revision_id") REFERENCES "public"."courses"("id","course_type_revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_registrations" ADD CONSTRAINT "interest_registrations_course_id_id_unique" UNIQUE("course_id","id");--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_course_interest_fk" FOREIGN KEY ("course_id","source_interest_id") REFERENCES "public"."interest_registrations"("course_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_command_receipts" ADD CONSTRAINT "registration_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_ledger" ADD CONSTRAINT "registration_ledger_registration_id_pre_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."pre_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_ledger" ADD CONSTRAINT "registration_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_ledger" ADD CONSTRAINT "registration_ledger_receipt_actor_fk" FOREIGN KEY ("command_receipt_id","actor_id") REFERENCES "public"."registration_command_receipts"("id","actor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_settings" ADD CONSTRAINT "registration_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_ci_unique" ON "participants" USING btree ("ci");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_registrations_active_person_course_unique" ON "pre_registrations" USING btree ("participant_id","course_id") WHERE "pre_registrations"."state" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "pre_registrations_course_group_state_idx" ON "pre_registrations" USING btree ("course_id","group_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "pre_registrations_group_idx" ON "pre_registrations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "pre_registrations_participant_idx" ON "pre_registrations" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "pre_registrations_revision_idx" ON "pre_registrations" USING btree ("course_type_revision_id");--> statement-breakpoint
CREATE INDEX "pre_registrations_interest_idx" ON "pre_registrations" USING btree ("source_interest_id");--> statement-breakpoint
CREATE INDEX "pre_registrations_created_by_idx" ON "pre_registrations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pre_registrations_cancelled_by_idx" ON "pre_registrations" USING btree ("cancelled_by");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_command_receipts_actor_key_unique" ON "registration_command_receipts" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_ledger_receipt_unique" ON "registration_ledger" USING btree ("command_receipt_id");--> statement-breakpoint
CREATE INDEX "registration_ledger_registration_recorded_idx" ON "registration_ledger" USING btree ("registration_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "registration_ledger_actor_idx" ON "registration_ledger" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "registration_settings_actor_idx" ON "registration_settings" USING btree ("updated_by");--> statement-breakpoint
INSERT INTO public.registration_settings (id) VALUES (1);
--> statement-breakpoint
REVOKE ALL ON TABLE public.participants, public.pre_registrations,
  public.registration_settings, public.registration_command_receipts,
  public.registration_ledger FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.guard_registration_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Registration financial history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_registration_append_only() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER registration_ledger_append_only BEFORE UPDATE OR DELETE ON public.registration_ledger
FOR EACH ROW EXECUTE FUNCTION public.guard_registration_append_only();
--> statement-breakpoint
CREATE TRIGGER registration_receipts_append_only BEFORE UPDATE OR DELETE ON public.registration_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_registration_append_only();
--> statement-breakpoint
CREATE FUNCTION public.guard_pre_registration_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registrations must be cancelled, not deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.participant_id, NEW.course_id, NEW.course_type_revision_id,
    NEW.source_interest_id, NEW.participant_type, NEW.currency, NEW.settings_revision,
    NEW.base_price_cents, NEW.discount_percent, NEW.total_price_cents,
    NEW.minimum_payment_percent, NEW.minimum_payment_cents, NEW.first_day_exception,
    NEW.created_by, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.participant_id, OLD.course_id, OLD.course_type_revision_id,
    OLD.source_interest_id, OLD.participant_type, OLD.currency, OLD.settings_revision,
    OLD.base_price_cents, OLD.discount_percent, OLD.total_price_cents,
    OLD.minimum_payment_percent, OLD.minimum_payment_cents, OLD.first_day_exception,
    OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Registration snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'CANCELLED' AND ROW(NEW.state, NEW.group_id, NEW.cancelled_at,
    NEW.cancelled_by, NEW.cancellation_reason, NEW.cancellation_note)
    IS DISTINCT FROM ROW(OLD.state, OLD.group_id, OLD.cancelled_at,
    OLD.cancelled_by, OLD.cancellation_reason, OLD.cancellation_note) THEN
    RAISE EXCEPTION 'Cancelled registration history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_pre_registration_history() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER pre_registration_history_guard BEFORE UPDATE OR DELETE ON public.pre_registrations
FOR EACH ROW EXECUTE FUNCTION public.guard_pre_registration_history();
