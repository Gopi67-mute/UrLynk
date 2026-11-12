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
