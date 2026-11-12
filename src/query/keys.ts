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
   * A member's photo, keyed by the version the member record reports.
   *
   * The version is part of the key on purpose: a new photo is a new entry, so it is
   * fetched once and then read from cache, and an old one is never shown after a change.
   */
  memberPhoto: (accountId: string, memberId: string, version: string | null) =>
    ["account", accountId, "members", memberId, "photo", version] as const,
};
