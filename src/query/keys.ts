/**
 * Query keys, every one of them under the signed-in account.
 *
 * Keying by the Clerk user ID means one account's cached data can never be read under
 * another account, even for the moment before the cache is cleared on a switch
 * (see the provider in src/app/_layout.tsx).
 */
export const queryKeys = {
  account: (accountId: string) => ["account", accountId] as const,
  team: (accountId: string) => ["account", accountId, "team"] as const,
  members: (accountId: string) => ["account", accountId, "members"] as const,
  member: (accountId: string, memberId: string) =>
    ["account", accountId, "members", memberId] as const,
  memberChildren: (accountId: string, memberId: string) =>
    ["account", accountId, "members", memberId, "children"] as const,
  recentMembers: (accountId: string) => ["account", accountId, "recent-members"] as const,
  /**
   * Search results for one exact query.
   *
   * The query is part of the key, which is what makes stale results impossible: a
   * response for "aja" is stored under "aja" and can never be rendered as the results
   * for "ajay". Switching back to a query already typed reads from cache instead of
   * asking again. It sits outside `members` so that invalidating a single member does
   * not refetch every search the user has run.
   */
  memberSearch: (accountId: string, query: string) =>
    ["account", accountId, "member-search", query] as const,
  /**
   * One member's chain of placements from the root.
   *
   * Under that member's own key, so removing a deleted member drops their path with
   * them. Invalidating the account refreshes it, which is what makes a path reflect a
   * reorganization rather than describing where someone used to sit.
   */
  placementPath: (accountId: string, memberId: string) =>
    ["account", accountId, "members", memberId, "placement-path"] as const,
  /**
   * A preview of what deleting this member would do, keyed by the promotion chosen.
   *
   * The choice is part of the key because the two options produce genuinely different
   * plans, with different destinations. Sitting under the member's own key means a
   * completed deletion drops every plan for them along with their record.
   */
  memberDeletionPlan: (accountId: string, memberId: string, promote: string | null) =>
    ["account", accountId, "members", memberId, "deletion-plan", promote] as const,
  /**
   * A member's photo, keyed by the version the member record reports.
   *
   * The version is part of the key on purpose: a new photo is a new entry, so it is
   * fetched once and then read from cache, and an old one is never shown after a change.
   */
  memberPhoto: (accountId: string, memberId: string, version: string | null) =>
    ["account", accountId, "members", memberId, "photo", version] as const,
};
