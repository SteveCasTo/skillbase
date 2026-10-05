ALTER TABLE "registration_ledger"
  DROP CONSTRAINT "registration_ledger_reason_check";
--> statement-breakpoint
ALTER TABLE "registration_ledger"
  ADD CONSTRAINT "registration_ledger_reason_check"
  CHECK (char_length(btrim("reason")) between 0 and 500 and "reason" !~ '[[:cntrl:]]');
