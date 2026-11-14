import { StyleSheet, Text, View } from "react-native";
import { isApiError } from "@/api/client";
import { Button } from "@/components/button";
import { Icon, type IconName } from "@/components/icon";
import { describeFailure, type FailureKind } from "@/lib/failure";
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

const FAILURE_ICON: Record<FailureKind, IconName> = {
  offline: "wifi_off",
  session: "lock",
  rejected: "error",
  server: "cloud_off",
  config: "error",
  unknown: "error",
};

/**
 * What a screen shows instead of data when a request fails: what happened, and the
 * one action that might fix it. Never a blank screen and never stale numbers.
 *
 * The action is offered only when another attempt could plausibly work — see
 * `describeFailure`. An ended session and a rejected request are both reported as
 * themselves rather than as connectivity problems, and neither shows a "Try again"
 * button that would send the identical request and fail the identical way.
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
  const failure = describeFailure(isApiError(error) ? error.kind : null, title);

  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Icon name={FAILURE_ICON[failure.kind]} size={26} color={statusColors.error.icon} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>
        {failure.title}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.message}>
        {failure.message}
      </Text>
      {onRetry && failure.canRetry ? (
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
