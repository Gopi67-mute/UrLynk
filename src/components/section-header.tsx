import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { colors, fontFamily, radius, spacing, typography } from "@/theme";

export function SectionHeader({
  icon,
  iconColor = colors.brand.indigo,
  title,
  accessory,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  accessory?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.titleGroup}>
        <Icon name={icon} size={26} color={iconColor} />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={styles.title}
        >
          {title}
        </Text>
      </View>
      {accessory}
    </View>
  );
}

/** The pill-shaped "View All" style link from the dashboard reference. */
export function SectionLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={spacing.sm}
      style={styles.link}
    >
      <Text maxFontSizeMultiplier={1.3} style={styles.linkLabel}>
        {label}
      </Text>
      <Icon name="arrow_forward" size={16} color={colors.brand.indigo} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  titleGroup: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
    flexShrink: 1,
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  linkLabel: {
    ...typography.bodySmall,
    fontFamily: fontFamily.semiBold,
    color: colors.brand.indigo,
  },
});
