import type { ApiClient } from "./client";

export type PlacementPosition = "LEFT" | "RIGHT";

/** Mirrors the backend's MemberSummary. */
export type MemberSummary = {
  id: string;
  name: string;
  mi_lifestyle_id: string | null;
  placement_position: PlacementPosition | null;
  is_root: boolean;
  joining_date: string | null;
  created_at: string;
  /**
   * When this member's photo last changed, or null when they have none. It doubles as
   * the photo's version: cache a photo by it and refetch only when it changes.
   */
  photo_updated_at: string | null;
};

/** A summary plus which of the member's two placement slots are filled. */
export type MemberListItem = MemberSummary & {
  has_left_child: boolean;
  has_right_child: boolean;
};

/** A newly registered member, as the dashboard's Recently Added section shows them. */
export type RecentMember = MemberSummary & {
  placement_parent_name: string | null;
};

export type MemberDetail = MemberListItem & {
  phone_number: string | null;
  notes: string | null;
  placement_parent: MemberSummary | null;
  sponsor: MemberSummary | null;
};

/** The photo itself, ready to hand straight to an Image source. */
export type MemberPhoto = {
  member_id: string;
  content_type: string;
  updated_at: string;
  data_uri: string;
};

/** A parent's two direct slots. `null` means the slot is free. */
export type MemberChildren = {
  parent_id: string;
  left: MemberSummary | null;
  right: MemberSummary | null;
};

export type MemberPage = {
  items: MemberListItem[];
  next_cursor: string | null;
};

/**
 * One search match, with just enough to recognise the right person.
 *
 * The placement parent is named because two members can share a name, and "LEFT under
 * Ajay" is what tells them apart. No phone number and no notes: a result is a way to
 * reach a member, not a copy of their record.
 */
export type MemberSearchResult = MemberSummary & {
  placement_parent_id: string | null;
  placement_parent_name: string | null;
};

export type MemberSearchPage = {
  items: MemberSearchResult[];
  next_cursor: string | null;
};

/**
 * The exact chain of placements from the team's root down to one member.
 *
 * `steps` is root first and the member last, and each step's `placement_position` is the
 * side it occupies under the step before it — so the root's null is correct rather than
 * missing, since nobody sits above it. Reading the list top to bottom is reading the way
 * down to the member.
 *
 * Calculated by PostgreSQL from the real placement relationships. Nothing here is
 * inferred from registration order, identifiers or timestamps, and the app never
 * reconstructs it from the tree.
 */
export type MemberPlacementPath = {
  member: MemberSummary;
  steps: MemberSummary[];
  /** Placement edges between the root and the member: `steps.length - 1`. */
  depth: number;
};

/** One step on the way down to a reattachment destination. */
export type PlacementPathEntry = {
  id: string;
  name: string;
  /**
   * The side this member occupies under the previous step. The first entry is the
   * promoted member, so it has none.
   */
  placement_position: PlacementPosition | null;
};

/** Where the child who is not promoted ends up, with everyone below them. */
export type SubtreeReattachment = {
  member: MemberSummary;
  /** That member and every descendant: how many people move. */
  member_count: number;
  destination: MemberSummary;
  destination_position: PlacementPosition;
  /** From the promoted member down to the destination, inclusive. */
  destination_path: PlacementPathEntry[];
};

/**
 * What deleting a member would do, as the backend calculates it.
 *
 * Three shapes, by how many members sit directly below the one being deleted:
 *
 * - none: `promotable` is empty, `promoted` and `reattachment` are null. An ordinary
 *   deletion.
 * - one: `promoted` already names them; there is nothing to choose and nothing to move.
 * - two: `requires_promotion_choice` is true and `promotable` holds both, LEFT first.
 *   Asking again with that choice fills in `promoted` and `reattachment`.
 *
 * `plan_token` fingerprints this exact plan. It is sent back to confirm, and a team
 * that changed in the meantime makes the confirmation a `reorganization_preview_stale`
 * refusal rather than a change the leader never saw.
 */
export type MemberDeletionPlan = {
  member: MemberSummary;
  placement_parent: MemberSummary | null;
  placement_position: PlacementPosition | null;
  promotable: MemberSummary[];
  requires_promotion_choice: boolean;
  promoted: MemberSummary | null;
  reattachment: SubtreeReattachment | null;
  plan_token: string;
};

/** What the confirmed deletion did, with the team's counts after it. */
export type MemberDeletionResult = {
  deleted_member_id: string;
  promoted: MemberSummary | null;
  reattached: MemberSummary | null;
  reattached_to: MemberSummary | null;
  reattached_position: PlacementPosition | null;
  counts: { total_members: number; left_members: number; right_members: number };
};

/** The fields POST /api/v1/members accepts. Anything else is rejected with 422. */
export type NewMember = {
  name: string;
  placement_parent_id: string;
  placement_position: PlacementPosition;
  /** Required, and exactly 10 digits. The backend refuses anything else with a 422. */
  mi_lifestyle_id: string;
  phone_number?: string;
  sponsor_id?: string;
  /** ISO date (YYYY-MM-DD). */
  joining_date?: string;
  notes?: string;
};

/**
 * The fields PATCH /api/v1/members/{id} accepts.
 *
 * Partial on purpose: a key that is absent is left alone, and an explicit `null`
 * clears that field. `name` can be changed but never cleared. Nothing structural is
 * here — placement, team, root status and the Clerk identity are not editable, and the
 * backend refuses a request that names one.
 */
export type MemberUpdate = {
  name?: string;
  /**
   * Exactly 10 digits. Unlike the other optional fields, `null` is refused: an
   * identifier can be corrected but never removed.
   */
  mi_lifestyle_id?: string | null;
  phone_number?: string | null;
  sponsor_id?: string | null;
  /** ISO date (YYYY-MM-DD). */
  joining_date?: string | null;
  notes?: string | null;
};

export const MEMBER_PAGE_SIZE = 50;

/** How many search results a page holds. The backend caps it at 50 regardless. */
export const SEARCH_PAGE_SIZE = 25;

/** How many recent members Home asks for. The backend caps it regardless. */
export const RECENT_MEMBER_COUNT = 5;

export function listMembers(
  client: ApiClient,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<MemberPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? MEMBER_PAGE_SIZE) });
  if (options.cursor) query.set("cursor", options.cursor);
  return client.request<MemberPage>(`/api/v1/members?${query.toString()}`, {
    signal: options.signal,
  });
}

export function getMember(
  client: ApiClient,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberDetail> {
  return client.request<MemberDetail>(`/api/v1/members/${memberId}`, { signal });
}

/**
 * Find members of the signed-in leader's own team by name or Mi Lifestyle ID.
 *
 * The matching happens in the database: the team is never downloaded and filtered here.
 * A name matches anywhere within it and without regard to case; a query of digits also
 * matches the start of a Mi Lifestyle ID, leading zeros included.
 *
 * Results come back ordered by name, so the same query twice gives the same order and
 * paging with `cursor` cannot repeat or skip a member. The backend rejects a blank query
 * (`search_query_required`) — callers are expected not to send one.
 */
export function searchMembers(
  client: ApiClient,
  query: string,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<MemberSearchPage> {
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? SEARCH_PAGE_SIZE),
  });
  if (options.cursor) params.set("cursor", options.cursor);
  return client.request<MemberSearchPage>(`/api/v1/members/search?${params.toString()}`, {
    signal: options.signal,
  });
}

/**
 * The exact placement path from the team's root down to this member.
 *
 * One request for the whole chain, calculated in the database — never one request per
 * ancestor, and never the tree. Rejects with `member_not_found` for a member of another
 * team, and `placement_chain_invalid` when the chain is damaged, which the screen
 * reports rather than drawing a partial path as if it were complete.
 */
export function getPlacementPath(
  client: ApiClient,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberPlacementPath> {
  return client.request<MemberPlacementPath>(
    `/api/v1/members/${memberId}/placement-path`,
    { signal },
  );
}

/** Only the two direct slots: no subtree is ever downloaded. */
export function getMemberChildren(
  client: ApiClient,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberChildren> {
  return client.request<MemberChildren>(`/api/v1/members/${memberId}/children`, { signal });
}

export function createMember(client: ApiClient, member: NewMember): Promise<MemberDetail> {
  return client.request<MemberDetail>("/api/v1/members", { method: "POST", body: member });
}

/** Change a member's own details. Only the keys present in `changes` are touched. */
export function updateMember(
  client: ApiClient,
  memberId: string,
  changes: MemberUpdate,
): Promise<MemberDetail> {
  return client.request<MemberDetail>(`/api/v1/members/${memberId}`, {
    method: "PATCH",
    body: changes,
  });
}

/**
 * Permanently delete one member. One member, never a branch.
 *
 * The backend refuses anything that would take more than the member themselves with it,
 * each with its own code: `root_member_undeletable` for the leader's own record,
 * `member_has_children` when anyone is placed below them, and `member_sponsors_others`
 * when another record names them as sponsor. A member of another team is `not_found`.
 */
export function deleteMember(client: ApiClient, memberId: string): Promise<void> {
  return client.request<void>(`/api/v1/members/${memberId}`, { method: "DELETE" });
}

/**
 * What deleting this member would do — a preview, and nothing more.
 *
 * Reads only: no position is reserved and nothing is written, so a leader can look at
 * a plan and walk away. `promote` picks which of two children takes the deleted
 * member's position, which is what fills in the destination for the other one's branch.
 *
 * Rejects with `root_member_undeletable` or `member_sponsors_others` for a member who
 * cannot be deleted at all, so the screen can say why before offering anything.
 */
export function getMemberDeletionPlan(
  client: ApiClient,
  memberId: string,
  options: { promote?: string | null; signal?: AbortSignal } = {},
): Promise<MemberDeletionPlan> {
  const query = options.promote ? `?promote=${encodeURIComponent(options.promote)}` : "";
  return client.request<MemberDeletionPlan>(
    `/api/v1/members/${memberId}/deletion-plan${query}`,
    { signal: options.signal },
  );
}

/**
 * Carry out the plan: reorganize the team and delete the member, or change nothing.
 *
 * `planToken` is the fingerprint from the preview the leader actually saw. The server
 * recalculates the plan and compares, so a team that changed in the meantime is a
 * `reorganization_preview_stale` refusal with nothing written — fetch the plan again
 * and show them the new one.
 *
 * The destination is never sent from here. It is the server's own, recalculated inside
 * the same transaction that applies it.
 */
export function confirmMemberDeletion(
  client: ApiClient,
  memberId: string,
  body: { promoteMemberId?: string | null; planToken: string },
): Promise<MemberDeletionResult> {
  return client.request<MemberDeletionResult>(`/api/v1/members/${memberId}/deletion`, {
    method: "POST",
    body: {
      plan_token: body.planToken,
      ...(body.promoteMemberId ? { promote_member_id: body.promoteMemberId } : {}),
    },
  });
}

/**
 * The team's most recently registered members, newest first.
 *
 * Real records from the members table, not an activity feed: the leader's own root
 * member is not included, so a team with nobody added yet comes back empty.
 */
export function listRecentMembers(
  client: ApiClient,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<RecentMember[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? RECENT_MEMBER_COUNT) });
  return client.request<RecentMember[]>(`/api/v1/members/recent?${query.toString()}`, {
    signal: options.signal,
  });
}

/**
 * A member's profile photo.
 *
 * Rejects with ApiError `not_found` (code `photo_not_found`) when they have none,
 * which is an ordinary answer rather than a failure: the caller draws initials.
 */
export function getMemberPhoto(
  client: ApiClient,
  memberId: string,
  signal?: AbortSignal,
): Promise<MemberPhoto> {
  return client.request<MemberPhoto>(`/api/v1/members/${memberId}/photo`, { signal });
}

/** Set or replace a member's photo. `data` is the image, base64 encoded. */
export function setMemberPhoto(
  client: ApiClient,
  memberId: string,
  photo: { content_type: string; data: string },
): Promise<MemberPhoto> {
  return client.request<MemberPhoto>(`/api/v1/members/${memberId}/photo`, {
    method: "PUT",
    body: photo,
  });
}

/** Remove a member's photo. Removing one they do not have is not an error. */
export function deleteMemberPhoto(client: ApiClient, memberId: string): Promise<void> {
  return client.request<void>(`/api/v1/members/${memberId}/photo`, { method: "DELETE" });
}
