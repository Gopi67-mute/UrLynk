import { router } from "expo-router";
import type { PlacementSide } from "@/theme";

/**
 * Where the app can go, in one place.
 *
 * Two operations, used deliberately:
 *
 * - `push` for anything that stacks on top of the current screen — a member, a form.
 *   Each one adds exactly one level, so a single back press returns to where the user
 *   came from, however deep they have gone.
 * - `navigate` for the tab destinations, which are peers rather than a stack: tapping
 *   through to Team should switch to that tab, not pile a second copy of it on top.
 */

/** One member's record. From Home or Team this is the leader's own profile. */
export function openMember(memberId: string) {
  router.push({ pathname: "/members/[id]", params: { id: memberId } });
}

/** The edit form for a member — Edit Profile when the member is the leader's own. */
export function openEditProfile(memberId: string) {
  router.push({ pathname: "/members/edit", params: { id: memberId } });
}

/**
 * The Add Member form, optionally with a position already chosen.
 *
 * Both arguments travel together: a parent without a side, or a side without a parent,
 * would leave the form half-filled in a way the user did not ask for.
 */
export function openAddMember(parentId?: string, position?: PlacementSide) {
  router.push({
    pathname: "/members/new",
    params: parentId && position ? { parent: parentId, position } : {},
  });
}

export function openTeam() {
  router.navigate("/team");
}

export function openSearch() {
  router.navigate("/search");
}

export function openSettings() {
  router.navigate("/settings");
}
