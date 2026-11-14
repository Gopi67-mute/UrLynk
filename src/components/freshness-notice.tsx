import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icon";
import { useNow } from "@/lib/clock";
import { lastSyncedText } from "@/lib/freshness";
import { needsFreshnessNotice, type ScreenState } from "@/lib/screen-state";
import {
  colors,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

/**
 * A quiet line above content that might be out of date.
 *
 * The rule it serves is a strict one: previously synchronized data may be shown without
 * a connection, but it may never be shown *as though* it were current. This is what
 * keeps that promise — one line, in the screen's own colours, saying what is true and
 * when it was last confirmed.
 *
 * Deliberately not an error card. A dashboard full of real numbers from four minutes
 * ago is useful, and replacing it with a red box would be both unhelpful and untrue.
 * It renders nothing at all in the states where nothing needs saying — including while
 * a background refresh is in flight, because the data is current as far as anyone knows
 * and something is already being done about it.
 */
export function FreshnessNotice({
  state,
  updatedAt,
}: {
  state: ScreenState;
  /** When this screen's data last came from the server, as a timestamp. */
  updatedAt: number | null | undefined;
}) {
  // A ticking clock rather than a reading taken once: "Updated 4 minutes ago" becomes
  // "Updated 5 minutes ago" while a leader sits on an offline screen, instead of
  // freezing at whatever it said when the screen first drew.
  const now = useNow();

  if (!needsFreshnessNotice(state)) return null;

  const offline = state === "offline-stale";
  const synced = lastSyncedText(updatedAt, now);
  const tone = offline ? statusColors.info : statusColors.warning;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: tone.background }]}
    >
      <Icon name={offline ? "wifi_off" : "sync_problem"} size={18} color={tone.icon} />
      <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={styles.text}>
        <Text style={styles.lead}>
          {offline ? "You're offline. " : "Couldn't refresh. "}
        </Text>
        {synced ? `${synced}.` : "Showing what was saved on this device."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
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
