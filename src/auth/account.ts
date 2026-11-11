import { useUser } from "@clerk/expo";

export type AccountProfile = {
  displayName: string;
  email: string | null;
  initials: string;
  imageUrl: string | null;
  createdAt: Date | null;
};

function getInitials(name: string) {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Identity details for display, read from the signed-in Clerk user only. */
export function useAccountProfile(): AccountProfile {
  const { user } = useUser();

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const displayName =
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    email?.split("@")[0] ||
    "Your account";

  return {
    displayName,
    email,
    initials: getInitials(displayName),
    // Clerk always returns an image URL; hasImage says whether one was uploaded.
    imageUrl: user?.hasImage ? user.imageUrl : null,
    createdAt: user?.createdAt ?? null,
  };
}
