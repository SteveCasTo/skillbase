export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "EMAIL_UNVERIFIED"
  | "NOT_INVITED"
  | "DISABLED"
  | "NO_ROLES"
  | "IDENTITY_CONFLICT"
  | "INVITATION_NOT_EDITABLE"
  | "FORBIDDEN";

export class AuthorizationError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}
