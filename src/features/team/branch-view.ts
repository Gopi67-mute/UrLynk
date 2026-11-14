/**
 * One side of the root, as Home and the Team screen both present it.
 *
 * The two screens draw the same facts differently — a card with a button, a node on a
 * small tree — so the facts live here, free of React, and each screen styles them. That
 * is also what stops the two from drifting into saying different things about the same
 * position.
 *
 * Nothing here counts anything itself. The sizes come from the team overview, where
 * PostgreSQL computed them with one recursive query over the real placement rows, so
 * they are the whole branch at every depth rather than the direct children or the order
 * members happened to be registered in.
 */

import type { SlotState } from "@/lib/slot-state";
import type { PlacementSide } from "@/theme";

/**
 * How each side is named in prose, when there is no count to show instead.
 *
 * The theme's `placementStyle` carries the same two words beside each side's colours,
 * for the pills the screens draw. They are repeated here because this module stays free
 * of every import the screens need: it is plain data and plain functions, so the unit
 * tests can run it directly under Node.
 */
const SIDE_TITLE: Record<PlacementSide, string> = {
  LEFT: "Left Team",
  RIGHT: "Right Team",
};

/** Just enough of a member for a branch position. */
export type BranchMember = {
  id: string;
  name: string;
};

/** Where tapping a branch position goes. Resolved by the screen, not here. */
export type BranchAction =
  /** Open this member's record, where the branch continues below them. */
  | { kind: "member"; memberId: string }
  /** Open Add Member with this position already chosen. */
  | { kind: "add"; parentId: string; position: PlacementSide }
  /** Nothing to do: the position is still loading, or its state is unknown. */
  | { kind: "none" };

export type BranchView = {
  state: SlotState;
  /** LEFT or RIGHT. */
  label: string;
  /** The member's name, or what is true about the position instead. */
  title: string;
  /** The line below the title: the branch size, or why there is no size to show. */
  meta: string;
  /**
   * How many members sit *below* the member in this position, at every depth, or null
   * when the team's counts are not available. Excludes that member themselves, who is
   * named on the card in their own right.
   */
  membersBelow: number | null;
  action: BranchAction;
  /** The label on the position's own action control. */
  actionLabel: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
};

/**
 * Members below the member holding a position, from that side's total.
 *
 * `sideTotal` is what the overview reports for the branch — the member in the position
 * plus everyone under them — so one is subtracted to leave the people *below* them.
 * Clamped at zero: a side total of zero means the position is empty, and "−1 members
 * below" is not a thing anyone should ever see.
 */
export function membersBelow(sideTotal: number | null): number | null {
  if (sideTotal === null) return null;
  return Math.max(0, sideTotal - 1);
}

/** "6 members below", in words a leader reads rather than a bare number. */
export function membersBelowText(below: number | null): string | null {
  if (below === null) return null;
  if (below === 0) return "No members below yet";
  return `${below} ${below === 1 ? "member" : "members"} below`;
}

export function branchView({
  side,
  member,
  sideTotal,
  state,
  rootId,
}: {
  side: PlacementSide;
  member: BranchMember | null;
  /** The branch's total from the team overview, or null when it is not available. */
  sideTotal: number | null;
  state: SlotState;
  /** The root member to place under; undefined before the team has loaded. */
  rootId: string | undefined;
}): BranchView {
  const label = side;
  const sideTitle = SIDE_TITLE[side];
  const below = membersBelow(sideTotal);
  const base = { state, label, membersBelow: below };

  if (state === "loading") {
    return {
      ...base,
      title: "Loading",
      meta: sideTitle,
      action: { kind: "none" },
      // The same label a filled position carries, so the control does not change its
      // wording under the user the moment the request lands. It stays disabled either way.
      actionLabel: "Explore Team",
      accessibilityLabel: `${label} position, loading`,
    };
  }

  // A position whose state could not be read is not known to be open. Offering to place
  // someone in it would invite a registration the backend then refuses, so it says what
  // it knows — nothing — and offers a refresh instead.
  if (state === "unavailable") {
    return {
      ...base,
      membersBelow: null,
      title: "Not available",
      meta: "Pull to refresh",
      action: { kind: "none" },
      actionLabel: "Unavailable",
      accessibilityLabel: `${label} position, not available`,
    };
  }

  if (state === "filled" && member) {
    const countText = membersBelowText(below);
    return {
      ...base,
      title: member.name,
      meta: countText ?? sideTitle,
      action: { kind: "member", memberId: member.id },
      actionLabel: "Explore Team",
      accessibilityLabel: `${label} position: ${member.name}${countText ? `. ${countText}` : ""}`,
      accessibilityHint: "Opens this member's record and the positions below them",
    };
  }

  // Open — but only actionable once the root is known, since that is what a new member
  // would be placed under.
  return {
    ...base,
    membersBelow: null,
    title: "Open position",
    meta: "No member yet",
    action: rootId ? { kind: "add", parentId: rootId, position: side } : { kind: "none" },
    actionLabel: "Add Member",
    accessibilityLabel: `${label} position is open`,
    accessibilityHint: rootId ? "Opens Add Member for this position" : undefined,
  };
}
