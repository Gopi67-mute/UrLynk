import { useAuth } from "@clerk/expo";

/**
 * The signed-in Clerk user ID, or null while signing in or signed out.
 *
 * Every query key starts with this, so cached server data belongs to exactly one
 * account. Queries stay disabled until it exists.
 */
export function useAccountId(): string | null {
  const { userId } = useAuth();
  return userId ?? null;
}
