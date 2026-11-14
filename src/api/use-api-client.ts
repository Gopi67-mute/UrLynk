import { useAuth } from "@clerk/expo";
import { useMemo } from "react";
import { startupTrace } from "@/lib/startup-trace";
import { createApiClient, type ApiClient, type RequestEvent } from "./client";

/**
 * Read once at bundle time. Expo inlines EXPO_PUBLIC_* values, so changing it in .env
 * needs a Metro restart. Over USB, `adb reverse tcp:8000 tcp:8000` makes
 * http://localhost:8000 on the phone reach the backend on this computer.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

/**
 * Write one line per finished request to the device log, in development only.
 *
 * This is how "how many requests does a cold start really make, and what does each
 * cost?" gets an answer rather than an estimate. The path never carries its query
 * string — `client.ts` strips it before reporting — so a search term cannot reach the
 * log. `attempts: 2` means the token was refreshed and the request sent again, which is
 * worth seeing separately from one slow request.
 */
function traceRequest(event: RequestEvent): void {
  const outcome = event.kind ? `FAILED ${event.kind}` : String(event.status);
  const retried = event.attempts > 1 ? ` attempts=${event.attempts}` : "";
  startupTrace.event(
    `api ${event.method} ${event.path} ${event.durationMs}ms ${outcome}${retried}`,
  );
}

/**
 * An API client bound to the signed-in Clerk session. Creating it makes no request;
 * call `request` from an effect or event handler, never during render.
 */
export function useApiClient(): ApiClient {
  const { getToken } = useAuth();

  return useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getToken: ({ forceRefresh }) => getToken({ skipCache: forceRefresh }),
        allowInsecureHttp: __DEV__,
        onRequestComplete: startupTrace.enabled ? traceRequest : undefined,
      }),
    [getToken],
  );
}
