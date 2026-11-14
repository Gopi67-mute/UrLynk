import "../../global.css";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { resourceCache } from "@clerk/expo/resource-cache";
import { tokenCache } from "@clerk/expo/token-cache";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import materialSymbols from "expo-symbols/androidWeights/regular";
import { deviceHeldSession, rememberSession } from "@/auth/session-hint";
import { QueryProvider } from "@/query/query-provider";
import { installConnectivityWatch } from "@/lib/connectivity";
import { startupGate } from "@/lib/startup-gate";
import { startupTrace } from "@/lib/startup-trace";
import { colors } from "@/theme/colors";

// Before anything renders: queries must know whether there is a connection from the
// first one they make, not from the first failure. See `connectivity.ts`.
installConnectivityWatch();

// The earliest moment in the JS bundle this app controls: everything measured from here
// is time the app itself is responsible for, with the native launch and the bundle load
// already behind it. See `startup-trace.ts`.
startupTrace.mark("js:root-layout");

// If this fails the splash simply auto-hides, so it is safe to continue.
SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.warn("[splash] Could not hold the native splash screen:", error);
});

/** Where a signed-out user lands, including right after signing out. */
export const unstable_settings = {
  anchor: "onboarding",
};

const FONT_LOAD_TIMEOUT_MS = 5000;
const AUTH_LOAD_TIMEOUT_MS = 5000;

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error("Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env file.");
}

let splashReleased = false;

/**
 * Hand the screen over from the native splash to React Native, once and once only.
 *
 * Called from `onLayout`, which is the one moment that answers the question the splash
 * is waiting on: *is there laid-out content behind me?* An effect cannot answer it —
 * effects run after a commit, which is before the view has been measured, let alone
 * drawn, and that gap is exactly where the blank frame between the splash and the first
 * screen used to come from. `hide()` is the synchronous form, so the handover cannot
 * slip a frame waiting for a promise to settle either.
 */
function releaseSplash(): void {
  if (splashReleased) return;
  splashReleased = true;

  startupTrace.mark("splash:hidden");
  try {
    SplashScreen.hide();
  } catch (error: unknown) {
    console.warn("[splash] Could not hide the native splash screen:", error);
  }
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [authLoadTimedOut, setAuthLoadTimedOut] = useState(false);

  // Read synchronously, before the first frame, and kept for the whole launch: whether
  // this device could be holding a session decides whether the public shell has to wait
  // for Clerk at all. See `session-hint.ts`.
  const [storedSession] = useState(deviceHeldSession);

  const gate = startupGate({
    fontsReady,
    authLoaded: isLoaded,
    isSignedIn: Boolean(isSignedIn),
    storedSession,
    authTimedOut: authLoadTimedOut,
  });

  // What the first second is spent on. `auth:loaded` is still the number to watch, but it
  // is no longer the floor under every other one: the public shell renders without it.
  useEffect(() => {
    if (isLoaded) startupTrace.mark("auth:loaded");
  }, [isLoaded]);

  useEffect(() => {
    if (gate.shellReady) startupTrace.mark("shell:ready");
  }, [gate.shellReady]);

  // Only a settled answer is recorded, so the next launch's bit is never a guess.
  useEffect(() => {
    if (isLoaded) rememberSession(Boolean(isSignedIn));
  }, [isLoaded, isSignedIn]);

  // A slow session restore must not hold the native splash indefinitely.
  useEffect(() => {
    if (isLoaded) return;

    const timeout = setTimeout(() => {
      console.warn(`[auth] Clerk did not load within ${AUTH_LOAD_TIMEOUT_MS}ms.`);
      setAuthLoadTimedOut(true);
    }, AUTH_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isLoaded]);

  if (!gate.shellReady) {
    return (
      <View style={styles.holding}>
        {gate.slowAuthNotice ? (
          // Mounted when the notice appears, so its own first layout is what releases
          // the splash. Adding the handler to the view above would not: that view has
          // already been laid out, and `onLayout` does not fire again for a new prop.
          <View onLayout={releaseSplash}>
            <Text style={styles.holdingNotice}>
              Still connecting. Check your internet connection.
            </Text>
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.interaction.primary} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.shell} onLayout={releaseSplash}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={gate.privateRoutes}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="members/new"
            options={{
              headerShown: true,
              title: "Add Member",
              headerTintColor: colors.ui.textPrimary,
              headerStyle: { backgroundColor: colors.ui.surface },
            }}
          />
          {/* A literal segment, so it is matched before members/[id] rather than read
              as a member ID. The member to edit comes from the `id` search parameter. */}
          <Stack.Screen
            name="members/edit"
            options={{
              headerShown: true,
              title: "Edit Profile",
              headerTintColor: colors.ui.textPrimary,
              headerStyle: { backgroundColor: colors.ui.surface },
            }}
          />
          {/* Also a literal segment, matched before members/[id]. The member to delete
              comes from the `id` search parameter. */}
          <Stack.Screen
            name="members/delete"
            options={{
              headerShown: true,
              title: "Delete Member",
              headerTintColor: colors.ui.textPrimary,
              headerStyle: { backgroundColor: colors.ui.surface },
            }}
          />
          {/* A literal segment too, matched before members/[id]. The member whose path
              is shown comes from the `id` search parameter. */}
          <Stack.Screen
            name="members/path"
            options={{
              headerShown: true,
              title: "Placement Path",
              headerTintColor: colors.ui.textPrimary,
              headerStyle: { backgroundColor: colors.ui.surface },
            }}
          />
          <Stack.Screen
            name="members/[id]"
            options={{
              headerShown: true,
              title: "Member",
              headerTintColor: colors.ui.textPrimary,
              headerStyle: { backgroundColor: colors.ui.surface },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={gate.publicRoutes}>
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="auth" />
        </Stack.Protected>
        {/* TEMPORARY Phase 4 check (src/app/dev-api-check.tsx): debug builds, signed in only. */}
        <Stack.Protected guard={gate.privateRoutes && __DEV__}>
          <Stack.Screen
            name="dev-api-check"
            options={{ headerShown: true, title: "API check (dev only)" }}
          />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Inter-Regular": require("../../assets/fonts/Inter_18pt-Regular.ttf"),
    "Inter-Medium": require("../../assets/fonts/Inter_18pt-Medium.ttf"),
    "Inter-SemiBold": require("../../assets/fonts/Inter_18pt-SemiBold.ttf"),
    "Inter-Bold": require("../../assets/fonts/Inter_18pt-Bold.ttf"),
    // The icon font, loaded up front so tab and screen icons draw immediately.
    [materialSymbols.name]: materialSymbols.font,
  });
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);

  const fontsPending = !fontsLoaded && !fontError;
  const canRenderApp = !fontsPending || fontLoadTimedOut;

  // A font-loading promise that never settles must not block the app.
  useEffect(() => {
    if (!fontsPending) return;

    const timeout = setTimeout(() => {
      console.warn(
        `[fonts] Fonts did not load within ${FONT_LOAD_TIMEOUT_MS}ms; using system fonts.`,
      );
      setFontLoadTimedOut(true);
    }, FONT_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [fontsPending]);

  useEffect(() => {
    if (fontError) {
      console.error("[fonts] Fonts failed to load:", fontError);
    } else if (fontsLoaded) {
      startupTrace.mark("fonts:ready");
      console.log("[fonts] Inter and icon fonts loaded.");
    }
  }, [fontsLoaded, fontError]);

  return (
    <ClerkProvider
      publishableKey={publishableKey!}
      tokenCache={tokenCache}
      /*
       * Lets Clerk start from the session it already has, instead of from the network.
       *
       * Without this the SDK resolves `isLoaded` only once it has reached Clerk's
       * servers, and everything below waits on that: measured at 1.7–2.3 s on a cold
       * start with a connection, and *never* without one — which made the app unusable
       * offline no matter how much of the team was cached on the device.
       *
       * It keeps snapshots of the environment, the client and the session JWT in
       * SecureStore (chunked and double-buffered by the SDK) and boots from them,
       * refreshing in the background with its own backoff. That is a change to how the
       * session is *restored*, not to who is trusted: the token still goes to FastAPI,
       * which verifies its signature, issuer and expiry on every single request, so a
       * session that has been revoked or has expired is refused by the backend whatever
       * this device believes. The identity it establishes is also what scopes the local
       * cache, so the rule that no cached data is shown before the account is known
       * still holds — it is simply known sooner.
       *
       * Prefixed `__experimental_` by Clerk as of @clerk/expo 4.15; it is the supported
       * route for offline resources (`@clerk/expo/secure-store` is deprecated).
       */
      __experimental_resourceCache={resourceCache}
    >
      <QueryProvider>
        <RootNavigator fontsReady={canRenderApp} />
      </QueryProvider>
    </ClerkProvider>
  );
}

/**
 * The native splash's own background, from the `expo-splash-screen` plugin in app.json.
 *
 * Everything that can be on screen at the moment of the handover is painted this colour,
 * so a frame drawn before the first screen has painted is indistinguishable from the
 * splash rather than a flash of a different shade. Keep the two in step.
 */
const SPLASH_BACKGROUND = colors.ui.surface;

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND,
  },
  holding: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SPLASH_BACKGROUND,
  },
  holdingNotice: {
    color: colors.ui.textSecondary,
  },
});
