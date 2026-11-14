import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icon";
import {
  colors,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

/**
 * Why a form will not save right now.
 *
 * V1 has no offline writes and deliberately does not queue them (AGENTS.md §5.2): a
 * placement decided on a phone with no signal is a decision the backend has not agreed
 * to, and sending it later — against a team that may have changed in the meantime — is
 * how two members end up in one position. So a form says it cannot save, up front,
 * rather than accepting something it will never send.
 *
 * Saying so is the whole point. A disabled button with no explanation reads as a bug;
 * with this line above it, it reads as the app being careful. Everything already on the
 * screen stays readable and editable — only the save is refused, so nothing a leader has
 * typed is lost by stepping into a lift.
 */
export function OfflineWriteBlock({ action }: { action: string }) {
  return (
    <View accessibilityRole="alert" style={styles.block}>
      <Icon name="wifi_off" size={18} color={statusColors.info.icon} />
      <Text maxFontSizeMultiplier={1.3} style={styles.text}>
        <Text style={styles.lead}>You&apos;re offline. </Text>
        {action} needs a connection. Nothing you&apos;ve entered is lost — reconnect and
        try again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: statusColors.info.background,
  },
  text: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textPrimary,
  },
  lead: {
    fontFamily: fontFamily.semiBold,
  },
});
