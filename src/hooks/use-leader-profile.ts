import { useAccountProfile } from "@/auth/account";
import { useMemberPhoto } from "@/hooks/use-members";
import { useTeamOverview } from "@/hooks/use-team";
import { initialsFor, teamLabelFor } from "@/lib/names";

export type LeaderProfile = {
  /** The root member's id, or undefined until the team has loaded. */
  memberId: string | undefined;
  /** The business-facing name: the leader's own, not the one their Gmail account has. */
  displayName: string;
  initials: string;
  /** The saved UrLynk photo, or null when there is none to show. */
  photoUri: string | null;
  /** The verified account's email, from Clerk. Identity, kept separate from the above. */
  email: string | null;
  /**
   * The team's label, derived from the leader's preferred name: "Gopinath's Team".
   *
   * Derived, never stored — see `teamLabelFor`. Null until the root member is known, or
   * when their name yields nothing usable, so a screen shows its own fallback.
   */
  teamName: string | null;
  /**
   * True until the saved profile is known.
   *
   * Worth honouring rather than ignoring: `displayName` falls back to the account
   * name while this is true, so a screen that renders it anyway would flash the
   * Google name before the preferred one on every cold start. Show a placeholder
   * for the name instead — the rest of the card can draw immediately.
   */
  isLoading: boolean;
};

/**
 * The leader as the app should present them, from one place.
 *
 * Two values are deliberately kept apart:
 *
 * - **Clerk** holds the verified account — the email, and whatever name Google gave at
 *   sign-up. Editing the UrLynk profile never changes it.
 * - **The root member record** holds the business profile: the preferred name and the
 *   photo the leader chose. That is what every screen shows.
 *
 * Home, Team and Settings all call this, so they cannot disagree about who the leader
 * is or what they look like. The Clerk name is used only as a fallback before the team
 * has loaded, which keeps the app shell rendering without waiting on the network.
 */
export function useLeaderProfile(): LeaderProfile {
  const account = useAccountProfile();
  const overview = useTeamOverview();
  const root = overview.data?.root_member;
  const photo = useMemberPhoto(root?.id, root?.photo_updated_at);

  // The saved preferred name wins. Before the team has loaded there is nothing saved
  // to show yet, so the account name stands in — see `isLoading` for why a screen
  // should prefer a placeholder over rendering that stand-in.
  const displayName = root?.name?.trim() || account.displayName;

  // Built from the root member's own name, never from the Clerk/Gmail one and never
  // from the stored `team_name`: that column was written once at sign-up from whatever
  // name Google supplied, so it would keep saying "jgopi nath's Team" after the leader
  // set their preferred name. Deriving it here means the label follows every edit, and
  // the saved preferred name is never rewritten just to produce a label.
  const teamName = teamLabelFor(root?.name);

  return {
    memberId: root?.id,
    displayName,
    initials: initialsFor(displayName),
    photoUri: photo.data?.data_uri ?? null,
    email: account.email,
    teamName,
    // `isLoading`, not `isPending`: a query that is disabled — before the account is
    // known — reports "pending" indefinitely, and a screen would wait on it forever.
    isLoading: overview.isLoading,
  };
}
