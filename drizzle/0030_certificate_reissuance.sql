-- Forward-only: revoked credentials remain permanent historical records.
LOCK TABLE "certificates" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DROP INDEX "certificates_one_current_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_one_current_unique" ON "certificates" ("group_id", "type", "recipient_id") WHERE "state" <> 'revoked';
