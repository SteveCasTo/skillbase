ALTER TABLE "registration_ledger" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "registration_ledger" ADD CONSTRAINT "registration_ledger_payment_method_check" CHECK ("registration_ledger"."payment_method" in ('CASH', 'QR'));
--> statement-breakpoint
-- Preserve genuinely unknown historical methods. New movements require one.
CREATE FUNCTION public.require_registration_payment_method() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.payment_method IS NULL THEN
    RAISE EXCEPTION 'A payment method is required for new ledger movements' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.require_registration_payment_method() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TRIGGER registration_ledger_require_payment_method
BEFORE INSERT ON public.registration_ledger
FOR EACH ROW EXECUTE FUNCTION public.require_registration_payment_method();
