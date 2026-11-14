import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemberDeletionPlan, MemberSummary, PlacementPosition } from "../../api/members.ts";
import {
  confirmationExplanation,
  confirmPromotionId,
  deletionFailureMessage,
  deletionStep,
  isSettledRefusal,
  isStale,
  memberIdFrom,
  memberNameFrom,
  movingCount,
  pathLabel,
  promotionSide,
  reattachmentSentence,
  refusalTitle,
} from "./deletion-plan.ts";

function summary(id: string, name: string, side: PlacementPosition | null = null): MemberSummary {
  return {
    id,
    name,
    mi_lifestyle_id: "0000000001",
    placement_position: side,
    is_root: false,
    joining_date: null,
    created_at: "2026-01-01T00:00:00Z",
    photo_updated_at: null,
  };
}

const jd = summary("jd", "Jd", "LEFT");
const ravi = summary("ravi", "Ravi", "LEFT");
const rk = summary("rk", "Rk", "RIGHT");
const kiran = summary("kiran", "Kiran", "LEFT");

function plan(overrides: Partial<MemberDeletionPlan> = {}): MemberDeletionPlan {
  return {
    member: jd,
    placement_parent: summary("root", "Gopinath J"),
    placement_position: "LEFT",
    promotable: [],
    requires_promotion_choice: false,
    promoted: null,
    reattachment: null,
    plan_token: "a".repeat(64),
    ...overrides,
  };
}

// --- which step the leader is on ---------------------------------------------------------

test("a member with nobody below them needs no reorganization", () => {
  assert.equal(deletionStep(plan()), "simple");
});

test("a member with one child goes straight to the review", () => {
  // There is nothing to choose, so asking would be a question with one answer.
  assert.equal(deletionStep(plan({ promotable: [ravi], promoted: ravi })), "review");
});

test("a member with two children asks who takes their position", () => {
  assert.equal(
    deletionStep(plan({ promotable: [ravi, rk], requires_promotion_choice: true })),
    "choose",
  );
});

test("a chosen promotion moves on to the review", () => {
  assert.equal(
    deletionStep(
      plan({
        promotable: [ravi, rk],
        promoted: ravi,
        reattachment: {
          member: rk,
          member_count: 1,
          destination: ravi,
          destination_position: "LEFT",
          destination_path: [{ id: "ravi", name: "Ravi", placement_position: null }],
        },
      }),
    ),
    "review",
  );
});

test("two candidates with no promotion yet is never treated as reviewable", () => {
  // Defensive: a plan with candidates but no promotion has no destination to show, so
  // it must not reach a screen that would describe one.
  assert.equal(deletionStep(plan({ promotable: [ravi, rk] })), "choose");
});

// --- what gets sent on confirmation --------------------------------------------------------

test("a member with one child confirms with that child named", () => {
  // The regression: nobody taps anything in this case, because there is nothing to
  // choose. Reading the tap back would send no promotion at all and the backend would
  // refuse it, leaving a member with one member below them impossible to delete.
  const oneChild = plan({ promotable: [ravi], promoted: ravi });

  assert.equal(confirmPromotionId(oneChild), "ravi");
});

test("a chosen promotion is the one confirmed", () => {
  const chosen = plan({ promotable: [ravi, rk], promoted: rk });

  assert.equal(confirmPromotionId(chosen), "rk");
});

test("a member with nobody below them confirms with no promotion", () => {
  // Naming anyone here is refused by the backend, and rightly: there is nobody to move.
  assert.equal(confirmPromotionId(plan()), null);
});

test("an unchosen two-child plan names nobody", () => {
  assert.equal(
    confirmPromotionId(plan({ promotable: [ravi, rk], requires_promotion_choice: true })),
    null,
  );
});

// --- the candidates ----------------------------------------------------------------------

test("a candidate reports the side they currently occupy", () => {
  const twoChildren = plan({ promotable: [ravi, rk], requires_promotion_choice: true });
  assert.equal(promotionSide(twoChildren, "ravi"), "LEFT");
  assert.equal(promotionSide(twoChildren, "rk"), "RIGHT");
});

test("a member who is not a candidate has no side here", () => {
  assert.equal(promotionSide(plan({ promotable: [ravi] }), "kiran"), null);
});

// --- the destination sentence ------------------------------------------------------------

test("a branch of several members is described as a whole team", () => {
  const withBranch = plan({
    promotable: [ravi, rk],
    promoted: ravi,
    reattachment: {
      member: rk,
      member_count: 4,
      destination: kiran,
      destination_position: "RIGHT",
      destination_path: [],
    },
  });

  assert.equal(
    reattachmentSentence(withBranch),
    "Rk and their entire team will be moved under Kiran at the RIGHT position.",
  );
  assert.equal(movingCount(withBranch), 4);
});

test("a single member being moved is not described as a team", () => {
  const single = plan({
    promotable: [ravi, rk],
    promoted: ravi,
    reattachment: {
      member: rk,
      member_count: 1,
      destination: ravi,
      destination_position: "LEFT",
      destination_path: [],
    },
  });

  assert.equal(
    reattachmentSentence(single),
    "Rk will be moved under Ravi at the LEFT position.",
  );
});

test("nothing is said about a reattachment when nothing is being reattached", () => {
  // A member with one child has no subtree to move, and a sentence about one would be
  // untrue.
  assert.equal(reattachmentSentence(plan({ promotable: [ravi], promoted: ravi })), null);
  assert.equal(movingCount(plan()), 0);
});

test("the destination path reads from the promoted member downwards", () => {
  assert.equal(
    pathLabel([
      { id: "ravi", name: "Ravi", placement_position: null },
      { id: "kiran", name: "Kiran", placement_position: "LEFT" },
      { id: "arun", name: "Arun", placement_position: "RIGHT" },
    ]),
    "Ravi  ›  Kiran  ›  Arun",
  );
});

// --- the final confirmation --------------------------------------------------------------

test("the explanation covers the promotion and the reattachment", () => {
  const explanation = confirmationExplanation(
    plan({
      promotable: [ravi, rk],
      promoted: ravi,
      reattachment: {
        member: rk,
        member_count: 3,
        destination: kiran,
        destination_position: "LEFT",
        destination_path: [],
      },
    }),
  );

  assert.match(explanation, /Ravi will take their position\./);
  assert.match(explanation, /Rk's entire team will be reattached under Kiran\./);
  assert.match(explanation, /profile information will be preserved/);
});

test("the explanation mentions no reattachment when there is only one child", () => {
  const explanation = confirmationExplanation(plan({ promotable: [ravi], promoted: ravi }));

  assert.match(explanation, /Ravi will take their position\./);
  assert.doesNotMatch(explanation, /reattached/);
});

test("a member with nobody below them gets a plain explanation", () => {
  assert.equal(
    confirmationExplanation(plan()),
    "Jd will be permanently removed from your team.",
  );
});

// --- refusals ----------------------------------------------------------------------------

test("a known refusal reads as its real reason", () => {
  assert.match(
    deletionFailureMessage("member_sponsors_others", "fallback"),
    /recorded as another member's sponsor/,
  );
  assert.match(
    deletionFailureMessage("reorganization_preview_stale", "fallback"),
    /changed while you were reviewing/,
  );
  assert.match(
    deletionFailureMessage("invalid_promotion_choice", "fallback"),
    /placed directly below/,
  );
});

test("an unrecognised failure falls back to the client's own message", () => {
  assert.equal(deletionFailureMessage("something_new", "Please try again."), "Please try again.");
  assert.equal(deletionFailureMessage(null, "Please try again."), "Please try again.");
  assert.equal(deletionFailureMessage(undefined, "Please try again."), "Please try again.");
});

test("a blocked member is named, so the leader knows whose profile to open", () => {
  const message = deletionFailureMessage("member_identifier_missing", "fallback", {
    member_id: "ravi",
    member_name: "Ravi",
    required_length: 10,
  });

  assert.match(message, /^Ravi doesn't have a Mi Lifestyle ID yet\./);
  assert.match(message, /Open their profile, add it/);
});

test("a blocked member with no name still gets a usable message", () => {
  // The details are whatever the server sent, so the wording cannot depend on them.
  for (const details of [undefined, null, {}, "nonsense", { member_name: 42 }]) {
    const message = deletionFailureMessage("member_identifier_missing", "fallback", details);
    assert.match(message, /Mi Lifestyle ID/);
    assert.doesNotMatch(message, /undefined|null|\[object/);
  }
});

test("a member name is read from details only when it is really there", () => {
  assert.equal(memberNameFrom({ member_name: "Ravi" }), "Ravi");
  assert.equal(memberNameFrom({ member_name: "" }), null);
  assert.equal(memberNameFrom({ member_name: 42 }), null);
  assert.equal(memberNameFrom({}), null);
  assert.equal(memberNameFrom(null), null);
  assert.equal(memberNameFrom(undefined), null);
  assert.equal(memberNameFrom("Ravi"), null);
});

test("only a stale plan asks the leader to review again", () => {
  assert.equal(isStale("reorganization_preview_stale"), true);
  assert.equal(isStale("reorganization_conflict"), false);
  assert.equal(isStale(null), false);
});

test("a refusal the leader must resolve is never offered as a retry", () => {
  // Retrying any of these changes nothing, so showing "refresh and try again" would be
  // both untrue and a loop with no way out — which is what the original failure did.
  for (const code of [
    "root_member_undeletable",
    "member_sponsors_others",
    "member_not_found",
    "member_identifier_missing",
  ]) {
    assert.equal(isSettledRefusal(code), true, code);
  }
});

test("a transient failure is still offered as a retry", () => {
  assert.equal(isSettledRefusal("reorganization_conflict"), false);
  assert.equal(isSettledRefusal("reorganization_preview_stale"), false);
  assert.equal(isSettledRefusal(null), false);
  assert.equal(isSettledRefusal(undefined), false);
});

test("a missing identifier is titled as the task it is, not as a dead end", () => {
  assert.equal(refusalTitle("member_identifier_missing"), "Add a Mi Lifestyle ID first");
  assert.equal(refusalTitle("root_member_undeletable"), "This member can't be deleted");
  assert.equal(refusalTitle(null), "This member can't be deleted");
});

test("the blocking member can be identified for a direct link to their profile", () => {
  assert.equal(memberIdFrom({ member_id: "ravi-uuid" }), "ravi-uuid");
  assert.equal(memberIdFrom({ member_id: "" }), null);
  assert.equal(memberIdFrom({}), null);
  assert.equal(memberIdFrom(null), null);
});
