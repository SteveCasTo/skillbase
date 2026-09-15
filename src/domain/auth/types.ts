export const AUTH_ROLES = ["ADMIN", "INSTRUCTOR"] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

export const USER_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface InternalUser {
  readonly id: string;
  readonly authUserId: string | null;
  readonly email: string;
  readonly name: string;
  readonly status: UserStatus;
  readonly roles: readonly AuthRole[];
}

export interface VerifiedIdentity {
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly provider: "google";
}
