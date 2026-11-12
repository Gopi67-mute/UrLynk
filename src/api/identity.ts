import type { ApiClient } from "./client";

/** Mirrors the backend's MeResponse: the identity proven by the session token. */
export type Me = {
  clerk_user_id: string;
  session_id: string | null;
};

/** GET /api/v1/me. Rejects with ApiError ("unauthorized" when the session is invalid). */
export function getMe(client: ApiClient, signal?: AbortSignal): Promise<Me> {
  return client.request<Me>("/api/v1/me", { signal });
}
