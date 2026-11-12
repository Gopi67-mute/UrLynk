import { StyleSheet, Text, View } from "react-native";
import { isApiError } from "@/api/client";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import {
  colors,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

/** The message to show the user for a failure, never the raw technical detail. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.userMessage;
  return "Something went wrong. Please try again.";
}

/**
 * What a screen shows instead of data when a request fails: what happened, and the
 * one action that might fix it. Never a blank screen and never stale numbers.
 */
export function ErrorState({
  error,
  onRetry,
  isRetrying = false,
  title = "We couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  title?: string;
}) {
  const offline = isApiError(error) && (error.kind === "network" || error.kind === "timeout");

  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Icon
          name={offline ? "wifi_off" : "error"}
          size={26}
          color={statusColors.error.icon}
        />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>
        {offline ? "You appear to be offline" : title}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.message}>
        {errorMessage(error)}
      </Text>
      {onRetry ? (
        <Button
          label="Try again"
          icon="refresh"
          variant="secondary"
          compact
          loading={isRetrying}
          onPress={onRetry}
        />
      ) : null}
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
    borderColor: `${colors.semantic.error}33`,
    backgroundColor: statusColors.error.background,
  },
  iconCircle: {
    width: 52,
    height: 52,
    marginBottom: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.neutral.white,
  },
  title: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  message: {
    ...typography.bodyMedium,
    marginBottom: spacing.xs,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
});
