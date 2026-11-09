import "../../global.css";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import { colors } from "@/theme/colors";

// If this fails the splash simply auto-hides, so it is safe to continue.
SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.warn("[splash] Could not hold the native splash screen:", error);
});

const FONT_LOAD_TIMEOUT_MS = 5000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Inter-Regular": require("../../assets/fonts/Inter_18pt-Regular.ttf"),
    "Inter-Medium": require("../../assets/fonts/Inter_18pt-Medium.ttf"),
    "Inter-SemiBold": require("../../assets/fonts/Inter_18pt-SemiBold.ttf"),
    "Inter-Bold": require("../../assets/fonts/Inter_18pt-Bold.ttf"),
  });
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);

  const fontsPending = !fontsLoaded && !fontError;
  const canRenderApp = !fontsPending || fontLoadTimedOut;

  // A font-loading promise that never settles must not block the app.
  useEffect(() => {
    if (!fontsPending) return;

    const timeout = setTimeout(() => {
      console.warn(
        `[fonts] Inter did not load within ${FONT_LOAD_TIMEOUT_MS}ms; using system fonts.`,
      );
      setFontLoadTimedOut(true);
    }, FONT_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [fontsPending]);

  useEffect(() => {
    if (fontError) {
      console.error("[fonts] Inter failed to load:", fontError);
    } else if (fontsLoaded) {
      console.log("[fonts] Inter loaded.");
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (!canRenderApp) return;

    SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn("[splash] Could not hide the native splash screen:", error);
    });
  }, [canRenderApp]);

  if (!canRenderApp) {
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

  return <Stack screenOptions={{ headerShown: false }} />;
}
