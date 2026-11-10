export type AuthMode = "signUp" | "signIn";

/** Raised while no authentication provider is integrated, so nothing can succeed. */
export class AuthNotConnectedError extends Error {
  constructor() {
    super("Authentication is not connected yet.");
    this.name = "AuthNotConnectedError";
  }
}

/**
 * The single seam the auth screen submits through. Phase 03 replaces this body
 * with Clerk's email verification flow; until then it must never report success.
 */
export async function continueWithEmail(
  _mode: AuthMode,
  _email: string,
): Promise<void> {
  throw new AuthNotConnectedError();
}
