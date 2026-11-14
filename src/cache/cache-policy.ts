/**
 * What is allowed to be written to the device, and for how long.
 *
 * Persisting server state is the difference between a dashboard that appears instantly
 * and one that waits for the network, so the question is not *whether* to cache but
 * exactly what — and every answer here is a decision about a leader's private team data
 * sitting on a phone's filesystem.
 *
 * Deliberately free of React, React Native and SQLite imports: this is the policy, and
 * it runs under `node --test` on its own. The storage that obeys it lives in
 * `sqlite-cache.ts`, and the persister that applies it in `query-persister.ts`.
 */

/**
 * Bumped whenever a cached shape changes in a way that would make an old snapshot
 * wrong — a renamed field, a changed query key, a different response from the API.
 *
 * It is the persister's "buster": a snapshot written under a different version is
 * discarded rather than restored, because rendering last week's shape through this
 * week's screens is how a cache turns into a bug report.
 */
export const CACHE_VERSION = "1";

/**
 * How old a snapshot may be and still be shown.
 *
 * Seven days. The data is revalidated the moment the app has a network, so this is not
 * about freshness — it is the point past which cached private data is no longer worth
 * keeping on the device for a leader who has not opened the app since. Beyond it the
 * snapshot is dropped and the app starts from a cold cache.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long to wait after a cache change before writing the snapshot.
 *
 * A single screen load settles dozens of queries in a few hundred milliseconds. Writing
 * once per change would serialize the whole cache dozens of times over; writing once,
 * after things stop moving, costs one.
 */
export const PERSIST_THROTTLE_MS = 1_000;

/** How many photos are kept per account. See `sqlite-cache.ts` for the pruning. */
export const MAX_CACHED_PHOTOS = 200;

/**
 * Every query key in this app starts `["account", accountId, …]` — see `query/keys.ts`.
 * A key that does not is not team data and is never persisted.
 */
const ACCOUNT_SEGMENT = "account";

/**
 * Key segments that mark a query as off-limits for the disk.
 *
 * - **`photo`** — not because it is sensitive but because it is big. A photo is a
 *   base64 data URI of up to 64 KB, and the dashboard holds eight of them; putting them
 *   in the snapshot would mean serializing most of a megabyte every time anything in the
 *   cache changed, which costs more than the requests it saves. Photos get their own
 *   table instead, read by key and never re-serialized (`sqlite-cache.ts`).
 * - **`member-search`** — a record of which members a leader went looking for, and when.
 *   Nothing about it needs to survive a restart: a search is a question being asked, not
 *   screen state, and the answer is one fast request away. It stays in memory, where the
 *   existing per-query keys already make it cheap to re-read within a session.
 * - **`deletion-plan`** — a description of a tree as it was at one moment. The backend
 *   refuses a plan it no longer agrees with, so a restored one could only ever be an
 *   invitation to confirm something that cannot happen.
 */
const NEVER_PERSISTED_SEGMENTS = new Set(["photo", "member-search", "deletion-plan"]);

/** What `shouldPersistQuery` needs to know about a cached query. */
export type PersistableQuery = {
  queryKey: readonly unknown[];
  /** TanStack Query's own status. Only `"success"` is worth keeping. */
  status: string;
};

/**
 * Whether this cached query may be written to the device, for this account.
 *
 * Three things have to hold, and the first is the one that matters:
 *
 * 1. **It belongs to this account.** The key must start `["account", accountId]`. A
 *    snapshot is written under one account and restored under the same one, so this is
 *    belt and braces — but it is the braces that stop a query somehow left over from a
 *    previous identity being written into the signed-in leader's file.
 * 2. It is not one of the kinds above.
 * 3. It actually succeeded. A failure is not an answer, and restoring one would show a
 *    leader an error from a week ago as though it had just happened.
 */
export function shouldPersistQuery(query: PersistableQuery, accountId: string): boolean {
  if (query.status !== "success") return false;

  const [scope, keyAccountId, ...rest] = query.queryKey;
  if (scope !== ACCOUNT_SEGMENT) return false;
  if (keyAccountId !== accountId) return false;

  return !rest.some(
    (segment) => typeof segment === "string" && NEVER_PERSISTED_SEGMENTS.has(segment),
  );
}

/**
 * Where one account's snapshot is stored.
 *
 * The account ID is part of the identity of the record, not a column to be filtered on
 * later: one row per account means reading the wrong leader's cache would take asking
 * for it by name.
 */
export function snapshotIdFor(accountId: string): string {
  return `${CACHE_VERSION}:${accountId}`;
}

/**
 * Whether a restored snapshot may be shown.
 *
 * `PersistQueryClientProvider` applies `buster` and `maxAge` itself; this is the same
 * decision expressed as a function so the rules can be tested directly, and so the
 * storage layer can drop a dead snapshot rather than read it on every launch.
 */
export function isSnapshotUsable(
  snapshot: { accountId: string; version: string; savedAt: number },
  context: { accountId: string; now: number },
): boolean {
  if (snapshot.accountId !== context.accountId) return false;
  if (snapshot.version !== CACHE_VERSION) return false;

  const age = context.now - snapshot.savedAt;
  // A snapshot stamped in the future means the device clock moved; treat it as unusable
  // rather than as valid for the next seven days plus however far the clock jumped.
  if (age < 0) return false;
  return age <= MAX_CACHE_AGE_MS;
}
