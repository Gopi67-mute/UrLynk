import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { Skeleton } from "@/components/skeleton";
import { colors, fontFamily, radius, spacing, typography } from "@/theme";

/** Shown in place of a number that is not known, instead of a zero or a guess. */
export const UNAVAILABLE_VALUE = "—";

export function StatTile({
  label,
  value,
  icon = "groups",
  accent,
  tint,
  loading = false,
}: {
  label: string;
  value: number | null;
  icon?: IconName;
  accent: string;
  tint: string;
  loading?: boolean;
}) {
  const display = value === null ? UNAVAILABLE_VALUE : String(value);

  return (
    <View
      accessible
      accessibilityLabel={
        loading ? `${label}: loading` : `${label}: ${value === null ? "not available" : value}`
      }
      style={[styles.tile, { backgroundColor: tint, borderColor: `${accent}33` }]}
    >
      <Icon name={icon} size={28} color={accent} />
      {loading ? (
        <View style={styles.valueSkeleton}>
          <Skeleton width={36} height={24} />
        </View>
      ) : (
        <Text maxFontSizeMultiplier={1.2} style={styles.value}>
          {display}
        </Text>
      )}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.2}
        style={styles.label}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  value: {
    ...typography.h2,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  valueSkeleton: {
    height: typography.h2.lineHeight,
    justifyContent: "center",
  },
  label: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
});
