import assert from "node:assert/strict";
import { test } from "node:test";
import { branchView, membersBelow, membersBelowText } from "./branch-view.ts";

const AJAY = { id: "member-ajay", name: "Ajay" };
const ROOT = "member-root";

test("the count below a position excludes the member holding it", () => {
  // The LEFT branch holds 7: Ajay, plus the 6 under him.
  assert.equal(membersBelow(7), 6);
  assert.equal(membersBelow(1), 0);
});

test("a count that is not available stays unknown rather than becoming zero", () => {
  assert.equal(membersBelow(null), null);
  assert.equal(membersBelowText(null), null);
});

test("an empty side never reads as a negative count", () => {
  assert.equal(membersBelow(0), 0);
});

test("the count is written the way it is read, and singular when it should be", () => {
  assert.equal(membersBelowText(6), "6 members below");
  assert.equal(membersBelowText(1), "1 member below");
  assert.equal(membersBelowText(0), "No members below yet");
});

test("a filled position names the member and the branch below them", () => {
  const view = branchView({
    side: "LEFT",
    member: AJAY,
    sideTotal: 7,
    state: "filled",
    rootId: ROOT,
  });

  assert.equal(view.title, "Ajay");
  assert.equal(view.membersBelow, 6);
  assert.equal(view.meta, "6 members below");
  assert.equal(view.actionLabel, "Explore Team");
  assert.deepEqual(view.action, { kind: "member", memberId: AJAY.id });
  assert.match(view.accessibilityLabel, /LEFT position: Ajay/);
  assert.match(view.accessibilityLabel, /6 members below/);
});

test("exploring a filled position opens that member, not a separate explorer", () => {
  const view = branchView({
    side: "RIGHT",
    member: { id: "member-amir", name: "Amir" },
    sideTotal: 6,
    state: "filled",
    rootId: ROOT,
  });

  assert.deepEqual(view.action, { kind: "member", memberId: "member-amir" });
  assert.equal(view.membersBelow, 5);
});

test("a filled position with no counts available still names the member", () => {
  const view = branchView({
    side: "LEFT",
    member: AJAY,
    sideTotal: null,
    state: "filled",
    rootId: ROOT,
  });

  assert.equal(view.title, "Ajay");
  assert.equal(view.membersBelow, null);
  // The side's own title, rather than a fabricated number.
  assert.equal(view.meta, "Left Team");
  assert.doesNotMatch(view.meta, /\d/);
});

test("an open position offers Add Member for that exact side", () => {
  const view = branchView({
    side: "RIGHT",
    member: null,
    sideTotal: 0,
    state: "open",
    rootId: ROOT,
  });

  assert.equal(view.title, "Open position");
  assert.equal(view.actionLabel, "Add Member");
  assert.deepEqual(view.action, { kind: "add", parentId: ROOT, position: "RIGHT" });
});

test("an open position is not actionable before the root member is known", () => {
  const view = branchView({
    side: "LEFT",
    member: null,
    sideTotal: null,
    state: "open",
    rootId: undefined,
  });

  assert.deepEqual(view.action, { kind: "none" });
  assert.equal(view.accessibilityHint, undefined);
});

test("a position still loading claims nothing and does nothing", () => {
  const view = branchView({
    side: "LEFT",
    member: null,
    sideTotal: 7,
    state: "loading",
    rootId: ROOT,
  });

  assert.deepEqual(view.action, { kind: "none" });
  assert.match(view.accessibilityLabel, /loading/);
  assert.notEqual(view.title, "Open position");
});

test("a position whose state failed to load is never drawn as open", () => {
  const view = branchView({
    side: "LEFT",
    member: null,
    sideTotal: 7,
    state: "unavailable",
    rootId: ROOT,
  });

  assert.equal(view.title, "Not available");
  assert.equal(view.actionLabel, "Unavailable");
  assert.deepEqual(view.action, { kind: "none" });
  // No count either: the member in the position is unknown, so the branch size below
  // them cannot be stated honestly.
  assert.equal(view.membersBelow, null);
});

test("each side is labelled by its own position", () => {
  const left = branchView({
    side: "LEFT",
    member: AJAY,
    sideTotal: 7,
    state: "filled",
    rootId: ROOT,
  });
  const right = branchView({
    side: "RIGHT",
    member: AJAY,
    sideTotal: 7,
    state: "filled",
    rootId: ROOT,
  });

  assert.equal(left.label, "LEFT");
  assert.equal(right.label, "RIGHT");
});
