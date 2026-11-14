import assert from "node:assert/strict";
import { test } from "node:test";
import { queryKeys } from "../query/keys.ts";
import {
  CACHE_VERSION,
  isSnapshotUsable,
  MAX_CACHE_AGE_MS,
  shouldPersistQuery,
  snapshotIdFor,
} from "./cache-policy.ts";

const ACCOUNT = "user_2abcDEF123";
const OTHER_ACCOUNT = "user_9zzzXYZ789";
const MEMBER = "11111111-1111-1111-1111-111111111111";

function persistable(queryKey: readonly unknown[], status = "success") {
  return shouldPersistQuery({ queryKey, status }, ACCOUNT);
}

test("the screens that must appear instantly are the ones that get persisted", () => {
  assert.ok(persistable(queryKeys.team(ACCOUNT)), "team overview");
  assert.ok(persistable(queryKeys.members(ACCOUNT)), "directory");
  assert.ok(persistable(queryKeys.member(ACCOUNT, MEMBER)), "member detail");
  assert.ok(persistable(queryKeys.memberChildren(ACCOUNT, MEMBER)), "branch slots");
  assert.ok(persistable(queryKeys.recentMembers(ACCOUNT)), "recently added");
  assert.ok(persistable(queryKeys.placementPath(ACCOUNT, MEMBER)), "placement path");
});

// Not sensitive, just large: eight 64 KB data URIs re-serialized on every cache change
// would cost more than the requests they save. They live in their own table instead.
test("photos never go into the snapshot", () => {
  assert.equal(persistable(queryKeys.memberPhoto(ACCOUNT, MEMBER, "2026-11-13T09:00:00Z")), false);
  assert.equal(persistable(queryKeys.memberPhoto(ACCOUNT, MEMBER, null)), false);
});

// Which members a leader went looking for is not screen state, and it does not belong
// on the filesystem a week later.
test("search results never go into the snapshot", () => {
  assert.equal(persistable(queryKeys.memberSearch(ACCOUNT, "ajay")), false);
  assert.equal(persistable(queryKeys.memberSearch(ACCOUNT, "0012")), false);
});

// A plan describes a tree at one moment, and the backend refuses one it no longer agrees
// with. Restoring it could only ever offer a confirmation that cannot succeed.
test("deletion plans never go into the snapshot", () => {
  assert.equal(persistable(queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, null)), false);
  assert.equal(persistable(queryKeys.memberDeletionPlan(ACCOUNT, MEMBER, "other-member")), false);
});

test("only a query that actually succeeded is kept", () => {
  for (const status of ["error", "pending"]) {
    assert.equal(persistable(queryKeys.team(ACCOUNT), status), false, status);
  }
});

// The braces behind the belt. A snapshot is written under one account and read back
// under the same one, but if a query from another identity were ever in the cache at
// the moment of a write, this is what stops it reaching the file.
test("another account's query is never written into this account's snapshot", () => {
  assert.equal(persistable(queryKeys.team(OTHER_ACCOUNT)), false);
  assert.equal(persistable(queryKeys.member(OTHER_ACCOUNT, MEMBER)), false);
  assert.equal(persistable(queryKeys.recentMembers(OTHER_ACCOUNT)), false);
});

test("a key that is not account-scoped at all is never persisted", () => {
  assert.equal(persistable(["something", "else"]), false);
  assert.equal(persistable([]), false);
});

test("a snapshot belongs to one account and one cache version", () => {
  assert.notEqual(snapshotIdFor(ACCOUNT), snapshotIdFor(OTHER_ACCOUNT));
  assert.ok(snapshotIdFor(ACCOUNT).startsWith(`${CACHE_VERSION}:`));
});

const NOW = 1_770_000_000_000;

function usable(snapshot: { accountId?: string; version?: string; savedAt?: number }) {
  return isSnapshotUsable(
    {
      accountId: snapshot.accountId ?? ACCOUNT,
      version: snapshot.version ?? CACHE_VERSION,
      savedAt: snapshot.savedAt ?? NOW - 1_000,
    },
    { accountId: ACCOUNT, now: NOW },
  );
}

test("a fresh snapshot for this account is usable", () => {
  assert.ok(usable({}));
});

test("another account's snapshot is never usable, however fresh", () => {
  assert.equal(usable({ accountId: OTHER_ACCOUNT, savedAt: NOW }), false);
});

test("a snapshot written by an older cache version is discarded", () => {
  assert.equal(usable({ version: "0" }), false);
});

test("a snapshot is usable right up to the age limit and not past it", () => {
  assert.ok(usable({ savedAt: NOW - MAX_CACHE_AGE_MS }));
  assert.equal(usable({ savedAt: NOW - MAX_CACHE_AGE_MS - 1 }), false);
});

// A device whose clock jumped forward and back would otherwise hand itself a snapshot
// that stays "fresh" for seven days past the point it should have expired.
test("a snapshot stamped in the future is treated as unusable", () => {
  assert.equal(usable({ savedAt: NOW + 60_000 }), false);
});
