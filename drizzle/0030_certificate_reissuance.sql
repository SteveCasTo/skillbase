-- Preserve all historical records while serializing the current-index replacement.
LOCK TABLE "certificates" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DROP INDEX "certificates_one_current_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_one_current_unique" ON "certificates" USING btree ("group_id","type","recipient_id") WHERE "certificates"."state" <> 'revoked';
