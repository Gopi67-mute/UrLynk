import { isApiError, type ApiClient } from "./client";
import type { MemberSummary } from "./members";

/** Mirrors the backend's TeamSummary. */
export type Team = {
  id: string;
  team_name: string;
  created_at: string;
};

/** `total_members` includes the leader, so it is always left + right + 1. */
export type TeamCounts = {
  total_members: number;
  left_members: number;
  right_members: number;
};

/** Mirrors the backend's TeamOverview: everything the Team screen needs at once. */
export type TeamOverview = {
  team: Team;
  root_member: MemberSummary;
  counts: TeamCounts;
};

export type InitializeAccountBody = {
  /** A label for a first-time setup only; the backend ignores it afterwards. */
  display_name?: string;
  team_name?: string;
};

/** POST /api/v1/auth/initialize. Idempotent: safe to call on any sign-in. */
export function initializeAccount(
  client: ApiClient,
  body: InitializeAccountBody,
  signal?: AbortSignal,
): Promise<TeamOverview> {
  return client.request<TeamOverview>("/api/v1/auth/initialize", {
    method: "POST",
    body,
    signal,
  });
}

/**
 * The signed-in leader's team, setting it up if this is their first sign-in.
 *
 * One request in the normal case. A leader who has never signed in before gets a 404
 * `team_not_initialized`, which this answers by calling the idempotent initialize
 * endpoint once and returning its (identically shaped) response.
 */
export async function getTeamOverview(
  client: ApiClient,
  options: { displayName?: string; signal?: AbortSignal } = {},
): Promise<TeamOverview> {
  try {
    return await client.request<TeamOverview>("/api/v1/teams/me", { signal: options.signal });
  } catch (error) {
    if (isApiError(error) && error.code === "team_not_initialized") {
      return initializeAccount(
        client,
        options.displayName ? { display_name: options.displayName } : {},
        options.signal,
      );
    }
    throw error;
  }
}
