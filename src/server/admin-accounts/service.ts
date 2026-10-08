import { getDatabase } from "@/server/db/client";
import { DrizzleAdminAccountRepository } from "@/server/db/repositories/admin-account-repository";
export function getAdminAccountRepository() {
  return new DrizzleAdminAccountRepository(getDatabase());
}
