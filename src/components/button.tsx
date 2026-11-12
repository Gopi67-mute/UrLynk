import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { colors, componentTokens, fontFamily, radius, spacing, typography } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Replaces the label with a spinner and blocks further presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Overrides the accent, for the green LEFT and blue RIGHT actions. */
  tone?: string;
  /** Shrinks to fit its content instead of filling the row. */
  compact?: boolean;
  accessibilityHint?: string;
};

/** The one button in the app: same height, radius and press feedback everywhere. */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  tone,
  compact = false,
  accessibilityHint,
}: ButtonProps) {
  const isInactive = disabled || loading;
  const accent = tone ?? colors.interaction.primary;

  const foreground = isInactive
    ? componentTokens.button.disabled.foreground
    : variant === "primary"
      ? colors.neutral.white
      : accent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : styles.full,
        variant === "primary" && { backgroundColor: accent },
        variant === "secondary" && [styles.outlined, { borderColor: accent }],
        variant === "ghost" && styles.ghost,
        isInactive && styles.inactive,
        pressed && !isInactive && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={20} color={foreground} /> : null}
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={[styles.label, { color: foreground }]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: componentTokens.button.height,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  full: {
    alignSelf: "stretch",
  },
  compact: {
    alignSelf: "flex-start",
    height: 44,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  outlined: {
    borderWidth: 1.5,
    backgroundColor: colors.ui.surface,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  inactive: {
    backgroundColor: componentTokens.button.disabled.background,
    borderColor: colors.ui.border,
  },
  pressed: {
    opacity: 0.82,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  label: {
    ...typography.button,
    fontFamily: fontFamily.semiBold,
    flexShrink: 1,
  },
});
