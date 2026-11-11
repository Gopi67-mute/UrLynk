import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, typography } from "@/theme";

export const SCREEN_GUTTER = spacing.lg;

/**
 * Scrolling body for a tab. The tab bar sits below it in the layout, so only
 * the status bar inset is needed here.
 */
export function TabScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.base },
        ]}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
      >
        {children}
      </ScrollView>
      {/* Keeps scrolled content from running under the status bar icons. */}
      <View
        pointerEvents="none"
        style={[styles.statusBarBackdrop, { height: insets.top }]}
      />
    </View>
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.pageHeader}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={styles.pageTitle}
      >
        {title}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.pageSubtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ui.screen,
    backgroundImage: `radial-gradient(circle at 100% 0%, ${colors.interaction.primaryLight} 0%, ${colors.ui.screen} 45%)`,
  },
  statusBarBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: `${colors.ui.screen}F2`,
  },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.xl,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageTitle: {
    ...typography.h2,
    fontFamily: typography.h1.fontFamily,
    color: colors.ui.textPrimary,
  },
  pageSubtitle: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
  },
});
