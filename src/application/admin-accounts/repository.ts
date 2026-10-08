import type {
  AdminAccountAction,
  AdminAccountDto,
  AdminAccountResult,
} from "@/domain/admin-accounts/types";
export interface AdminDeletionIntent {
  readonly authUserId: string;
  readonly completed: boolean;
  readonly actorActive: boolean;
}
export interface AdminAccountRepository {
  authorize(actorId: string): Promise<void>;
  list(actorId: string): Promise<readonly AdminAccountDto[]>;
  get(actorId: string, id: string): Promise<AdminAccountDto | null>;
  emailExists(actorId: string, email: string): Promise<boolean>;
  create(
    actorId: string,
    input: { name: string; email: string; authUserId: string },
  ): Promise<AdminAccountDto>;
  rename(
    actorId: string,
    id: string,
    name: string,
    revision: Date,
  ): Promise<AdminAccountResult>;
  setActive(
    actorId: string,
    id: string,
    action: "activate" | "deactivate",
    revision: Date,
  ): Promise<AdminAccountResult>;
  beginDeletion(
    actorId: string,
    id: string,
    action: Extract<AdminAccountAction, "delete" | "retry-delete">,
    revision: Date,
  ): Promise<AdminDeletionIntent>;
  completeDeletion(
    actorId: string,
    id: string,
    authUserId: string,
  ): Promise<AdminAccountResult>;
}
export interface AdminCredentialGateway {
  createConfirmedUser(email: string, password: string): Promise<string | null>;
  removeCreatedUser(authUserId: string): Promise<void>;
  deleteUser(authUserId: string): Promise<void>;
}
