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

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data renders immediately and refreshes in the background.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        // There is no window to focus on Android, and the screens refresh on mount.
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A write is never retried automatically: the user decides whether to try again.
        retry: false,
      },
    },
  });
}
