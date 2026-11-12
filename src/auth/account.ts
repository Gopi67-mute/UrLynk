import { useUser } from "@clerk/expo";
import { initialsFor } from "@/lib/names";

export type AccountProfile = {
  displayName: string;
  email: string | null;
  initials: string;
  imageUrl: string | null;
  createdAt: Date | null;
};

type ClerkUser = ReturnType<typeof useUser>["user"];

/** The best name Clerk knows for this account, or null when it knows none. */
function deriveDisplayName(user: ClerkUser): string | null {
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  return (
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    email?.split("@")[0] ||
    null
  );
}

/**
 * The name to record for the leader's own member record on a first sign-in.
 *
 * `undefined` when Clerk has nothing to offer — an email-and-password sign-up carries
 * no name — and the backend then falls back to its own neutral default rather than
 * inventing one.
 */
export function useLeaderName(): string | undefined {
  const { user } = useUser();
  return deriveDisplayName(user) ?? undefined;
}

/** Identity details for display, read from the signed-in Clerk user only. */
export function useAccountProfile(): AccountProfile {
  const { user } = useUser();

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const displayName = deriveDisplayName(user) ?? "Your account";

  return {
    displayName,
    email,
    initials: initialsFor(displayName),
    // Clerk always returns an image URL; hasImage says whether one was uploaded.
    imageUrl: user?.hasImage ? user.imageUrl : null,
    createdAt: user?.createdAt ?? null,
  };
}
