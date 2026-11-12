import { useAuth } from "@clerk/expo";
import { useMemo } from "react";
import { createApiClient, type ApiClient } from "./client";

/**
 * Read once at bundle time. Expo inlines EXPO_PUBLIC_* values, so changing it in .env
 * needs a Metro restart. Over USB, `adb reverse tcp:8000 tcp:8000` makes
 * http://localhost:8000 on the phone reach the backend on this computer.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

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
      }),
    [getToken],
  );
}
