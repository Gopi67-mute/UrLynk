/**
 * TEMPORARY, DEVELOPMENT ONLY: Phase 4 end-to-end API check.
 * Delete this file and its Stack.Screen entry in _layout.tsx once Phase 4 is signed off.
 *
 * Calls the backend over the USB link with the real Clerk session token and shows only
 * pass/fail results. The token is never stored in state, displayed or logged; the
 * screen shows a shortened user ID and whether it matches the signed-in Clerk user.
 *
 * Open it on the USB-connected phone (debug build, signed in):
 *   adb shell am start -a android.intent.action.VIEW -d "urlynk://dev-api-check" com.jdaloo.UrLynk
 */
import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createApiClient, isApiError, type ApiClient } from "@/api/client";
import { getMe } from "@/api/identity";
import { useApiClient } from "@/api/use-api-client";
import { colors } from "@/theme/colors";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type CheckState = "idle" | "running" | "pass" | "fail";
type CheckResult = { state: CheckState; detail: string };

const CHECKS = [
  { id: "health", label: "GET /health (no token)" },
  { id: "health-db", label: "GET /health/db (no token)" },
  { id: "me-no-token", label: "GET /api/v1/me without a token is refused" },
  { id: "me-bad-token", label: "GET /api/v1/me with a forged token is refused" },
  { id: "me", label: "GET /api/v1/me with the Clerk session token" },
  { id: "me-fresh", label: "GET /api/v1/me with a freshly minted token" },
] as const;

type CheckId = (typeof CHECKS)[number]["id"];

const IDLE: CheckResult = { state: "idle", detail: "Not run" };

/** Enough of an ID to recognise it, not the whole value. */
function shortId(value: string | null | undefined): string {
  if (!value) return "none";
  return value.length <= 14 ? value : `${value.slice(0, 9)}…${value.slice(-4)}`;
}

/** Describes a failure without ever including request headers or the token. */
function describeError(error: unknown): string {
  if (isApiError(error)) {
    const parts: string[] = [error.kind];
    if (error.status !== null) parts.push(`HTTP ${error.status}`);
    if (error.code) parts.push(`code ${error.code}`);
    if (error.requestId) parts.push(`request ${error.requestId.slice(0, 8)}`);
    return parts.join(" · ");
  }
  return error instanceof Error ? error.name : "Unknown error";
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await run();
  return { value, ms: Date.now() - started };
}

/** Passes only when the request is rejected as unauthorized (401). */
async function expectUnauthorized(run: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await run();
    return { state: "fail", detail: "Accepted, but should have been refused" };
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthorized" && error.status === 401) {
      return { state: "pass", detail: `Refused: ${describeError(error)}` };
    }
    return { state: "fail", detail: `Unexpected error: ${describeError(error)}` };
  }
}

export default function DevApiCheckScreen() {
  const { isSignedIn, userId, sessionId, getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const client = useApiClient();
  const [results, setResults] = useState<Record<CheckId, CheckResult>>(() =>
    Object.fromEntries(CHECKS.map((check) => [check.id, IDLE])) as Record<CheckId, CheckResult>,
  );
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  // Sends a token that is well-formed but not issued by Clerk.
  const forgedClient = useMemo<ApiClient>(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getToken: async () => "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZvcmdlZCJ9.eyJzdWIiOiJmb3JnZWQifQ.c2ln",
        allowInsecureHttp: __DEV__,
      }),
    [],
  );

  // Always asks Clerk for a newly minted token instead of the cached one.
  const freshClient = useMemo<ApiClient>(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getToken: () => getToken({ skipCache: true }),
        allowInsecureHttp: __DEV__,
      }),
    [getToken],
  );

  const runAll = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const set = (id: CheckId, result: CheckResult) =>
      setResults((previous) => ({ ...previous, [id]: result }));

    const checkMe = async (id: CheckId, apiClient: ApiClient) => {
      set(id, { state: "running", detail: "Running…" });
      try {
        const { value: me, ms } = await timed(() => getMe(apiClient));
        const userMatches = me.clerk_user_id === userId;
        const sessionMatches = me.session_id === sessionId;
        set(id, {
          state: userMatches && sessionMatches ? "pass" : "fail",
          detail:
            `user ${shortId(me.clerk_user_id)} ${userMatches ? "matches" : "DOES NOT match"} Clerk · ` +
            `session ${sessionMatches ? "matches" : "DOES NOT match"} · ${ms} ms`,
        });
      } catch (error) {
        set(id, { state: "fail", detail: describeError(error) });
      }
    };

    try {
      for (const [id, path] of [
        ["health", "/health"],
        ["health-db", "/health/db"],
      ] as const) {
        set(id, { state: "running", detail: "Running…" });
        try {
          const { ms } = await timed(() => client.request(path, { authenticated: false }));
          set(id, { state: "pass", detail: `200 OK · ${ms} ms` });
        } catch (error) {
          set(id, { state: "fail", detail: describeError(error) });
        }
      }

      set("me-no-token", { state: "running", detail: "Running…" });
      set(
        "me-no-token",
        await expectUnauthorized(() => client.request("/api/v1/me", { authenticated: false })),
      );

      set("me-bad-token", { state: "running", detail: "Running…" });
      set("me-bad-token", await expectUnauthorized(() => getMe(forgedClient)));

      await checkMe("me", client);
      await checkMe("me-fresh", freshClient);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [client, forgedClient, freshClient, sessionId, userId]);

  if (!__DEV__ || !isSignedIn) return <Redirect href="/" />;

  const passed = CHECKS.filter((check) => results[check.id].state === "pass").length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.banner}>Development-only check. Not part of the app.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>API base URL</Text>
        <Text style={styles.value}>{API_URL || "Not set (add EXPO_PUBLIC_API_URL to .env)"}</Text>
        <Text style={styles.label}>Signed-in Clerk user</Text>
        <Text style={styles.value}>{shortId(userId)}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={running}
        onPress={runAll}
        style={({ pressed }) => [
          styles.button,
          (pressed || running) && { backgroundColor: colors.interaction.primaryPressed },
        ]}
      >
        <Text style={styles.buttonText}>{running ? "Running…" : "Run checks"}</Text>
      </Pressable>

      <Text style={styles.summary}>
        {passed} of {CHECKS.length} passed
      </Text>

      {CHECKS.map((check) => {
        const result = results[check.id];
        return (
          <View key={check.id} style={styles.card}>
            <Text style={styles.checkTitle}>
              {SYMBOL[result.state]} {check.label}
            </Text>
            <Text style={[styles.detail, { color: STATE_COLOR[result.state] }]}>
              {result.detail}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const SYMBOL: Record<CheckState, string> = { idle: "○", running: "…", pass: "✓", fail: "✗" };
const STATE_COLOR: Record<CheckState, string> = {
  idle: colors.ui.textSecondary,
  running: colors.ui.textSecondary,
  pass: "#047857",
  fail: "#B91C1C",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ui.screen },
  content: { padding: 16, gap: 12 },
  banner: {
    backgroundColor: "#FFFBEB",
    color: colors.ui.textPrimary,
    padding: 12,
    borderRadius: 8,
  },
  card: {
    backgroundColor: colors.ui.surface,
    borderColor: colors.ui.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  label: { color: colors.ui.textSecondary, fontSize: 12 },
  value: { color: colors.ui.textPrimary, fontSize: 14, marginBottom: 4 },
  button: {
    backgroundColor: colors.interaction.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: colors.neutral.white, fontSize: 16, fontWeight: "600" },
  summary: { color: colors.ui.textPrimary, fontSize: 14, fontWeight: "600" },
  checkTitle: { color: colors.ui.textPrimary, fontSize: 14 },
  detail: { fontSize: 13 },
});
