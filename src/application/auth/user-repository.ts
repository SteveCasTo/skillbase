import type {
  AuthRole,
  InternalUser,
  VerifiedIdentity,
} from "@/domain/auth/types";

export interface PreprovisionUserInput {
  readonly email: string;
  readonly name: string;
  readonly roles: readonly AuthRole[];
}

export interface AuthUserRepository {
  findByAuthUserId(authUserId: string): Promise<InternalUser | null>;
  linkVerifiedInvitation(identity: VerifiedIdentity): Promise<InternalUser>;
  preprovision(input: PreprovisionUserInput): Promise<InternalUser>;
}
