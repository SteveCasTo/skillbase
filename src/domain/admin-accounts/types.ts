export type AdminAccountAction =
  "delete" | "deactivate" | "activate" | "retry-delete";
export interface AdminAccountDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly status: "INVITED" | "ACTIVE" | "DISABLED";
  readonly revision: string;
  readonly exclusiveAdmin: boolean;
  readonly hasActivity: boolean;
  readonly deletionPending: boolean;
  readonly action: AdminAccountAction | null;
}
export interface CreateAdminAccountInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}
export interface AdminAccountResult {
  readonly account: AdminAccountDto | null;
  readonly actorActive: boolean;
  readonly deleted: boolean;
}
