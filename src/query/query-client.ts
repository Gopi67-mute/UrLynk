import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/api/client";

const RETRYABLE_FAILURES = new Set(["network", "timeout", "unavailable", "server"]);
const MAX_RETRIES = 2;

/**
 * Retry only what retrying can fix.
 *
 * A dropped connection or a backend restart is worth another attempt; a rejected
 * session, a validation error or a missing record is not, and retrying those only
 * delays the message the user needs to see.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (!isApiError(error)) return false;
  return RETRYABLE_FAILURES.has(error.kind);
}

/**
 * How long a query stays in the cache after nothing is reading it any more.
 *
 * A day, where it used to be five minutes, and the reason is persistence: the snapshot
 * written to the device is whatever is in memory at the time, so a query collected after
 * five minutes is a query missing from the next launch's dashboard. The number that
 * matters is the gap between two uses of the app, not the gap between two screens.
 *
 * It is not a freshness setting and does not make anything stale readable as current:
 * `staleTime` still expires after thirty seconds, so a cached screen renders immediately
 * and is refreshed in the background the moment it is looked at.
 */
const CACHE_RETENTION_MS = 24 * 60 * 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data renders immediately and refreshes in the background.
        staleTime: 30_000,
        gcTime: CACHE_RETENTION_MS,
        retry: shouldRetry,
        // There is no window to focus on Android, and the screens refresh on mount.
        refetchOnWindowFocus: false,
        // With `onlineManager` told the truth by `connectivity.ts`, this is what turns a
        // connection coming back into a refresh of what went stale while it was gone —
        // of the stale queries only, not of everything, and without the user asking.
        refetchOnReconnect: true,
      },
      mutations: {
        // A write is never retried automatically: the user decides whether to try again.
        retry: false,
      },
    },
  });
}
