import type { BottomTabBarProps } from "expo-router/tabs";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
} from "@/theme";

const ICON_SIZE = 26;
const INDICATOR_WIDTH = 32;
const { active: ACTIVE_COLOR, inactive: INACTIVE_COLOR } =
  componentTokens.navigation;

/**
 * The bar is laid out below the tab scenes rather than floating over them, so
 * screen content never sits underneath it. Its bottom padding clears the
 * Android navigation bar.
 */
export function AppTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label = options.title ?? route.name;
        const color = isFocused ? ACTIVE_COLOR : INACTIVE_COLOR;

        function handlePress() {
          const event = emitter.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigateToTab(route.key);
          }
        }

        function handleLongPress() {
          emitter.emit({ type: "tabLongPress", target: route.key });
        }

        return (
          <TouchableOpacity
            key={route.key}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            accessibilityState={{ selected: isFocused }}
            onPress={handlePress}
            onLongPress={handleLongPress}
            style={styles.item}
          >
            {options.tabBarIcon?.({ focused: isFocused, color, size: ICON_SIZE })}
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[
                styles.label,
                { color },
                isFocused && styles.activeLabel,
              ]}
            >
              {label}
            </Text>
            <View
              style={[
                styles.indicator,
                isFocused && { backgroundColor: ACTIVE_COLOR },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: componentTokens.navigation.border,
    backgroundColor: componentTokens.navigation.background,
    boxShadow: `0px -6px 24px ${colors.brand.indigo}14`,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingTop: spacing.xs,
    minHeight: 56,
  },
  label: {
    ...componentTokens.navigation.labelTypography,
  },
  activeLabel: {
    fontFamily: fontFamily.semiBold,
  },
  indicator: {
    width: INDICATOR_WIDTH,
    height: 3,
    marginTop: 2,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
});
