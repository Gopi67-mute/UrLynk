/**
 * Turning a deletion plan into the words the leader reads.
 *
 * Kept apart from the screen, and free of React, so the wording and the decisions about
 * which step to show can be tested directly. Nothing here calculates placement: the
 * destination always comes from the backend, which is the only thing that knows the
 * live tree.
 */

import type { MemberDeletionPlan, PlacementPathEntry, PlacementPosition } from "@/api/members";

/** Which step of the flow a plan puts the leader on. */
export type DeletionStep =
  /** Nobody is below this member: the plain confirmation, no reorganization. */
  | "simple"
  /** Two members are below: the leader has to choose who takes the position. */
  | "choose"
  /** The choice is made (or there was only one): show what will happen and confirm. */
  | "review";

export function deletionStep(plan: MemberDeletionPlan): DeletionStep {
  if (plan.promotable.length === 0) return "simple";
  if (plan.requires_promotion_choice || plan.promoted === null) return "choose";
  return "review";
}

/**
 * Who to name as the promotion when confirming this plan.
 *
 * Taken from the plan rather than from whatever the leader tapped, because those are
 * not the same thing: a member with exactly one member below them has nothing to choose,
 * so the backend fills in `promoted` and the screen never records a selection. Reading
 * the selection back in that case would send nothing at all, and the confirmation would
 * be refused as `invalid_promotion_choice` — a member with one child below them could
 * never be deleted from the app.
 *
 * Reading it from the plan is also the more honest thing to send: it is exactly the
 * member the preview said would take the position, which is what the leader agreed to.
 * `null` is right for a member with nobody below them, where naming anyone is refused.
 */
export function confirmPromotionId(plan: MemberDeletionPlan): string | null {
  return plan.promoted?.id ?? null;
}

/** The side a candidate for promotion currently occupies. */
export function promotionSide(plan: MemberDeletionPlan, memberId: string): PlacementPosition | null {
  return plan.promotable.find((candidate) => candidate.id === memberId)?.placement_position ?? null;
}

/**
 * The destination, written the way the leader needs to read it.
 *
 * Returns null when nothing is being reattached — a member with one child, or none, has
 * no subtree to move, and inventing a sentence about one would be misleading.
 */
export function reattachmentSentence(plan: MemberDeletionPlan): string | null {
  const reattachment = plan.reattachment;
  if (!reattachment) return null;

  const people =
    reattachment.member_count > 1
      ? `${reattachment.member.name} and their entire team`
      : reattachment.member.name;

  return (
    `${people} will be moved under ${reattachment.destination.name} ` +
    `at the ${reattachment.destination_position} position.`
  );
}

/** How many members move with the reattached branch, including that member. */
export function movingCount(plan: MemberDeletionPlan): number {
  return plan.reattachment?.member_count ?? 0;
}

/** "Ravi › Kiran › Meena": the way down to the destination, for the path row. */
export function pathLabel(path: PlacementPathEntry[]): string {
  return path.map((step) => step.name).join("  ›  ");
}

/**
 * The explanation under the final confirmation.
 *
 * Says only what is true of this particular plan: a promotion on its own when there is
 * one child, a promotion and a reattachment when there are two.
 */
export function confirmationExplanation(plan: MemberDeletionPlan): string {
  const promoted = plan.promoted;
  if (!promoted) {
    return `${plan.member.name} will be permanently removed from your team.`;
  }

  const sentences = [`${promoted.name} will take their position.`];

  const reattachment = plan.reattachment;
  if (reattachment) {
    const branch =
      reattachment.member_count > 1
        ? `${reattachment.member.name}'s entire team`
        : reattachment.member.name;
    sentences.push(
      `${branch} will be reattached under ${reattachment.destination.name}.`,
    );
  }

  sentences.push("Existing members and their profile information will be preserved.");
  return sentences.join(" ");
}

/**
 * Why a deletion or a reorganization was refused, in this screen's terms.
 *
 * The client's generic status messages are wrong for these: every one of them is a 409
 * or 422 with a stable code the backend documents, and "this changed in the meantime,
 * refresh and try again" would either be vague or invite a retry that cannot succeed.
 */
export const DELETION_FAILURE_MESSAGES: Record<string, string> = {
  member_has_children:
    "This member has members placed below them. Review the reorganization and confirm it.",
  member_sponsors_others:
    "This member is recorded as another member's sponsor. Change that sponsor first.",
  root_member_undeletable: "This is your own record as team leader, so it can't be deleted.",
  member_not_found: "This member is no longer in your team.",
  invalid_promotion_choice:
    "That member isn't placed directly below this one. Choose one of the members shown.",
  reorganization_preview_stale:
    "Your team changed while you were reviewing this. Check the updated plan and confirm again.",
  reorganization_conflict:
    "We couldn't reorganize your team safely, so nothing was changed. Please try again.",
  member_identifier_missing:
    "A member being moved doesn't have a Mi Lifestyle ID yet. Open their profile, add " +
    "it, and then try again.",
};

/**
 * The message to show for a failed deletion, whatever went wrong.
 *
 * `details` is the structured payload the backend sends with some refusals. When it
 * names the member standing in the way, the message says who — the leader is being
 * asked to go and fix something, so "a member" is not good enough. The sentence is
 * still composed here rather than taken from the server.
 */
export function deletionFailureMessage(
  code: string | null | undefined,
  fallback: string,
  details?: unknown,
): string {
  if (code === "member_identifier_missing") {
    const name = memberNameFrom(details);
    if (name) {
      return (
        `${name} doesn't have a Mi Lifestyle ID yet. Open their profile, add it, ` +
        "and then try again."
      );
    }
  }
  return (code && DELETION_FAILURE_MESSAGES[code]) || fallback;
}

/** The member named in an error's structured details, when there is one. */
export function memberNameFrom(details: unknown): string | null {
  return stringField(details, "member_name");
}

/** The member identified in an error's structured details, when there is one. */
export function memberIdFrom(details: unknown): string | null {
  return stringField(details, "member_id");
}

function stringField(details: unknown, key: string): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Refusals that are an answer rather than a failure to retry.
 *
 * Each describes something true about the team that a retry cannot change: the leader's
 * own record, a sponsor relationship, a member who needs an identifier first. Showing
 * these as "refresh and try again" would send the leader round a loop that never ends,
 * so the screen states the reason and, where there is one, offers the way out.
 */
const SETTLED_REFUSALS = new Set([
  "root_member_undeletable",
  "member_sponsors_others",
  "member_not_found",
  "member_identifier_missing",
]);

export function isSettledRefusal(code: string | null | undefined): boolean {
  return Boolean(code && SETTLED_REFUSALS.has(code));
}

/** The heading for a refusal that the leader has to resolve before deleting. */
export function refusalTitle(code: string | null | undefined): string {
  if (code === "member_identifier_missing") return "Add a Mi Lifestyle ID first";
  return "This member can't be deleted";
}

/** True while a stale plan needs to be reviewed again before it can be confirmed. */
export function isStale(code: string | null | undefined): boolean {
  return code === "reorganization_preview_stale";
}
