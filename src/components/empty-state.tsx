import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
  typography,
} from "@/theme";

/** Says plainly that data is not available, instead of showing sample data. */
export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: IconName;
  title: string;
  message: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={28} color={colors.interaction.primary} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
  },
  iconCircle: {
    width: 56,
    height: 56,
    marginBottom: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  title: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  message: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
});
