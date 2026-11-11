import "../../global.css";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import materialSymbols from "expo-symbols/androidWeights/regular";
import { colors } from "@/theme/colors";

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

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [authLoadTimedOut, setAuthLoadTimedOut] = useState(false);

  const isReady = fontsReady && isLoaded;
  const canHideSplash = isReady || (fontsReady && authLoadTimedOut);

  // A slow session restore must not hold the native splash indefinitely.
  useEffect(() => {
    if (isLoaded) return;

    const timeout = setTimeout(() => {
      console.warn(`[auth] Clerk did not load within ${AUTH_LOAD_TIMEOUT_MS}ms.`);
      setAuthLoadTimedOut(true);
    }, AUTH_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isLoaded]);

  useEffect(() => {
    if (!canHideSplash) return;

    SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn("[splash] Could not hide the native splash screen:", error);
    });
  }, [canHideSplash]);

  if (!isReady) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.ui.screen,
        }}
      >
        <ActivityIndicator size="large" color={colors.interaction.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={Boolean(isSignedIn)}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="auth" />
      </Stack.Protected>
    </Stack>
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
      console.log("[fonts] Inter and icon fonts loaded.");
    }
  }, [fontsLoaded, fontError]);

  return (
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
      <RootNavigator fontsReady={canRenderApp} />
    </ClerkProvider>
  );
}
