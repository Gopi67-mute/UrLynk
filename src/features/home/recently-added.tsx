import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RecentMember } from "@/api/members";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Icon } from "@/components/icon";
import { PlacementBadge } from "@/components/member-card";
import { MemberFace } from "@/components/member-face";
import { SkeletonCard } from "@/components/skeleton";
import { SectionHeader } from "@/components/section-header";
import { useRecentMembers } from "@/hooks/use-members";
import { useScreenStatus } from "@/hooks/use-screen-state";
import { formatIsoDate, formatTimestampDate } from "@/lib/names";
import { openMember } from "@/lib/navigation";
import { startupTrace } from "@/lib/startup-trace";
import { colors, componentTokens, fontFamily, radius, spacing, typography } from "@/theme";
import { sectionStateFor } from "./section-state";

/**
 * The members most recently added to the team.
 *
 * Called "Recently Added", not "Recent Activity", because that is what it is: a query
 * over the members table ordered by when each was registered. It is not an event
 * history, so it does not claim to show renames, edits or placements — those need the
 * audit log that arrives in a later phase.
 *
 * It owns its own request. Home renders without waiting for it, and if it fails only
 * this section says so, with a way to try again.
 */
export function RecentlyAdded() {
  const recent = useRecentMembers();
  // One decision, made in one place and tested on its own: see `sectionStateFor` for
  // why a failure outranks an empty list, and why "offline" is neither of them.
  const status = useScreenStatus(recent);
  const state = sectionStateFor(status.state, recent.data?.length ?? null);

  useEffect(() => {
    if (recent.data) startupTrace.mark("home:recent");
  }, [recent.data]);

  return (
    <View style={styles.section}>
      <SectionHeader icon="group_add" title="Recently Added" />

      {state === "loading" ? (
        <View style={styles.list}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : state === "error" ? (
        <ErrorState
          error={recent.error}
          title="We couldn't load your recent members"
          onRetry={() => void recent.refetch()}
          isRetrying={recent.isFetching}
        />
      ) : state === "offline" ? (
        <EmptyState
          icon="wifi_off"
          title="Not saved on this device yet"
          message="Your recent members will be here once UrLynk has loaded them with a connection, and will stay readable after that."
        />
      ) : state === "empty" ? (
        <EmptyState
          icon="group_add"
          title="No members added yet"
          message="Members you register will appear here, newest first, with the position they were placed in."
        />
      ) : (
        <View style={styles.list}>
          {(recent.data ?? []).map((member) => (
            <RecentRow key={member.id} member={member} />
          ))}
        </View>
      )}
    </View>
  );
}

function RecentRow({ member }: { member: RecentMember }) {
  const side = member.placement_position;

  // The day they joined when it was recorded, otherwise the day they were added here.
  // Two different kinds of value: a joining date is a calendar day, while created_at
  // is an instant, so each is formatted by the helper that understands it.
  const joined = member.joining_date
    ? `Joined ${formatIsoDate(member.joining_date)}`
    : `Added ${formatTimestampDate(member.created_at)}`;

  const placement = member.placement_parent_name
    ? `${side} under ${member.placement_parent_name}`
    : side;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${member.name}. ${placement ?? ""}. ${joined}`}
      accessibilityHint="Opens this member's details"
      onPress={() => openMember(member.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* Their photograph when they have one, their initials when they do not. */}
      <MemberFace member={member} size={44} side={side ?? undefined} />

      <View style={styles.body}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.name}>
          {member.name}
        </Text>
        {member.placement_parent_name ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.meta}>
            Under {member.placement_parent_name}
          </Text>
        ) : null}
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.meta}>
          {joined}
        </Text>
      </View>

      {side ? <PlacementBadge side={side} small /> : null}
      <Icon name="chevron_right" size={22} color={colors.ui.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 2px 10px ${colors.brand.indigo}0F`,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  name: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  meta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
});
