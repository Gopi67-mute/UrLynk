import assert from "node:assert/strict";
import { test } from "node:test";
import { queryKeys } from "./keys.ts";

const ACCOUNT = "user_2abcDEF123";
const OTHER_ACCOUNT = "user_9zzzXYZ789";
const MEMBER = "11111111-1111-1111-1111-111111111111";

/** Does `key` start with `prefix`? This is what TanStack Query matches on. */
function startsWith(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((segment, index) => key[index] === segment);
}

const TEAM_SCOPED_KEYS = [
  ["team", queryKeys.team(ACCOUNT)],
  ["directory", queryKeys.members(ACCOUNT)],
  ["one member", queryKeys.member(ACCOUNT, MEMBER)],
  ["a member's children", queryKeys.memberChildren(ACCOUNT, MEMBER)],
  ["recent members", queryKeys.recentMembers(ACCOUNT)],
  ["a member's photo", queryKeys.memberPhoto(ACCOUNT, MEMBER, "2026-11-13T09:00:00Z")],
  ["a deletion plan", queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, null)],
  ["search results", queryKeys.memberSearch(ACCOUNT, "ajay")],
  ["a placement path", queryKeys.placementPath(ACCOUNT, MEMBER)],
] as const;

// This is the whole contract behind "a successful change refreshes the dashboard": every
// mutation invalidates `queryKeys.account(accountId)`, and TanStack Query invalidates by
// key prefix. A key that did not sit under the account key would survive that and keep
// serving numbers from before the change.
for (const [name, key] of TEAM_SCOPED_KEYS) {
  test(`invalidating the account refreshes ${name}`, () => {
    assert.ok(startsWith(key, queryKeys.account(ACCOUNT)));
  });
}

test("one account's invalidation never reaches another account's cache", () => {
  for (const [, key] of TEAM_SCOPED_KEYS) {
    assert.ok(!startsWith(key, queryKeys.account(OTHER_ACCOUNT)));
  }
});

test("the same query for two accounts is two separate cache entries", () => {
  assert.notDeepEqual(queryKeys.team(ACCOUNT), queryKeys.team(OTHER_ACCOUNT));
  assert.notDeepEqual(
    queryKeys.recentMembers(ACCOUNT),
    queryKeys.recentMembers(OTHER_ACCOUNT),
  );
  assert.notDeepEqual(
    queryKeys.member(ACCOUNT, MEMBER),
    queryKeys.member(OTHER_ACCOUNT, MEMBER),
  );
});

test("Home and Team read the one team entry, so opening both costs one request", () => {
  assert.deepEqual(queryKeys.team(ACCOUNT), queryKeys.team(ACCOUNT));
});

test("a member's children and photo sit under that member, so deleting them drops both", () => {
  const member = queryKeys.member(ACCOUNT, MEMBER);

  assert.ok(startsWith(queryKeys.memberChildren(ACCOUNT, MEMBER), member));
  assert.ok(startsWith(queryKeys.memberPhoto(ACCOUNT, MEMBER, "v1"), member));
  assert.ok(startsWith(queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, null), member));
});

test("a photo is cached per version, so a changed photo is never served stale", () => {
  assert.notDeepEqual(
    queryKeys.memberPhoto(ACCOUNT, MEMBER, "2026-11-13T09:00:00Z"),
    queryKeys.memberPhoto(ACCOUNT, MEMBER, "2026-11-13T10:00:00Z"),
  );
});

test("a deletion plan is cached per promotion choice", () => {
  assert.notDeepEqual(
    queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, "member-left"),
    queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, "member-right"),
  );
});

// This is what makes a slow earlier search unable to overwrite a later one: each query
// has its own cache entry, so a response can only ever be stored under the query that
// asked for it.
test("each search query is its own cache entry, so an older response cannot replace a newer one", () => {
  assert.notDeepEqual(
    queryKeys.memberSearch(ACCOUNT, "aja"),
    queryKeys.memberSearch(ACCOUNT, "ajay"),
  );
});

test("one leader's search results are never read under another account", () => {
  assert.notDeepEqual(
    queryKeys.memberSearch(ACCOUNT, "nair"),
    queryKeys.memberSearch(OTHER_ACCOUNT, "nair"),
  );
});

test("search results sit outside a member, so editing one does not refetch every search", () => {
  assert.ok(!startsWith(queryKeys.memberSearch(ACCOUNT, "ajay"), queryKeys.member(ACCOUNT, MEMBER)));
});

test("a placement path sits under its member, so deleting them drops it with their record", () => {
  assert.ok(startsWith(queryKeys.placementPath(ACCOUNT, MEMBER), queryKeys.member(ACCOUNT, MEMBER)));
});
