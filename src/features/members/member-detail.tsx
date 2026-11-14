import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { isApiError } from "@/api/client";
import type { MemberDetail as Member, MemberSummary, PlacementPosition } from "@/api/members";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FreshnessNotice } from "@/components/freshness-notice";
import { Icon, type IconName } from "@/components/icon";
import { MemberCard, PlacementBadge } from "@/components/member-card";
import { Skeleton, SkeletonCard } from "@/components/skeleton";
import { deletionFailureMessage } from "@/features/members/deletion-plan";
import { useDeleteMember, useMember, useMemberChildren, useMemberPhoto } from "@/hooks/use-members";
import { useScreenStatus } from "@/hooks/use-screen-state";
import { formatIsoDate, initialsFor } from "@/lib/names";
import {
  openAddMember,
  openDeleteMember,
  openEditProfile,
  openMember,
  openPlacementPath,
} from "@/lib/navigation";
import {
  colors,
  componentTokens,
  fontFamily,
  placementStyle,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

const NOT_RECORDED = "Not recorded";

/** One member: who they are, where they sit, and the two positions below them. */
export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const member = useMember(id);
  const children = useMemberChildren(id);
  const status = useScreenStatus(member);

  function refresh() {
    void member.refetch();
    void children.refetch();
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: member.data?.name ?? "Member" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={member.isRefetching || children.isRefetching}
            onRefresh={refresh}
            colors={[colors.interaction.primary]}
            tintColor={colors.interaction.primary}
          />
        }
      >
        {/* A member opened before is drawn from the device straight away, with the
            notice above saying when their details were last confirmed. */}
        <FreshnessNotice state={status.state} updatedAt={status.updatedAt} />

        {member.data ? (
          <LoadedMember
            member={member.data}
            left={children.data?.left ?? null}
            right={children.data?.right ?? null}
            childrenPending={children.isPending}
            childrenError={children.isError ? children.error : null}
            onRetryChildren={() => void children.refetch()}
          />
        ) : status.state === "offline-empty" ? (
          <EmptyState
            icon="wifi_off"
            title="This member isn't on this device"
            message="You haven't opened them with a connection yet, so there's nothing saved to show. Members you have opened stay readable offline."
          />
        ) : status.state === "failed" ? (
          <ErrorState
            error={member.error}
            title="We couldn't load this member"
            onRetry={refresh}
            isRetrying={member.isFetching}
          />
        ) : (
          <LoadingMember />
        )}
      </ScrollView>
    </View>
  );
}

function LoadedMember({
  member,
  left,
  right,
  childrenPending,
  childrenError,
  onRetryChildren,
}: {
  member: Member;
  left: MemberSummary | null;
  right: MemberSummary | null;
  childrenPending: boolean;
  childrenError: unknown;
  onRetryChildren: () => void;
}) {
  const side = member.placement_position;
  // The member's own photo, keyed by the version their record reports. The leader's is
  // the same image Home and Team show, because all three read this one value.
  const photo = useMemberPhoto(member.id, member.photo_updated_at);

  return (
    <>
      <View style={styles.headerCard}>
        <Avatar
          size={72}
          initials={initialsFor(member.name)}
          imageUri={photo.data?.data_uri ?? null}
          ringColor={colors.interaction.primaryLight}
        />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={styles.headerName}
        >
          {member.name}
        </Text>
        <View style={styles.headerBadges}>
          {member.is_root ? (
            <View style={styles.rootBadge}>
              <Icon name="verified_user" size={14} color={colors.interaction.primary} />
              <Text allowFontScaling={false} style={styles.rootBadgeLabel}>
                TEAM LEADER
              </Text>
            </View>
          ) : null}
          {side ? <PlacementBadge side={side} /> : null}
        </View>
        <Button
          label={member.is_root ? "Edit Profile" : "Edit Member"}
          icon="edit"
          variant="secondary"
          compact
          onPress={() => openEditProfile(member.id)}
          accessibilityHint={
            member.is_root
              ? "Change your name, photo and business details"
              : "Change this member's details"
          }
        />
      </View>

      <Card icon="badge" title="Member information">
        <InfoRow icon="fingerprint" label="Mi Lifestyle ID" value={member.mi_lifestyle_id} />
        <InfoRow icon="call" label="Phone number" value={member.phone_number} />
        <InfoRow
          icon="event"
          label="Joining date"
          value={member.joining_date ? formatIsoDate(member.joining_date) : null}
        />
        <InfoRow icon="notes" label="Notes" value={member.notes} multiline />
      </Card>

      <Card icon="account_tree" title="Placement">
        {/* The exact chain from the leader down to this member, calculated by the
            backend from the real placement relationships. Offered for the leader's own
            record too, where it is a path of one step and says so. */}
        <Button
          label="View Placement Path"
          icon="account_tree"
          variant="secondary"
          compact
          onPress={() => openPlacementPath(member.id)}
          accessibilityHint={
            member.is_root
              ? "Shows your own position at the top of the team"
              : "Shows every LEFT and RIGHT step from you down to this member"
          }
        />

        {member.is_root ? (
          <Text maxFontSizeMultiplier={1.3} style={styles.rootNote}>
            This is your own record at the root of the team, so it has no placement
            parent or position.
          </Text>
        ) : (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.cardLabel}>
              Placed under
            </Text>
            {member.placement_parent ? (
              <MemberCard
                member={member.placement_parent}
                onPress={() => openMember(member.placement_parent!.id)}
              />
            ) : (
              <Text style={styles.value}>{NOT_RECORDED}</Text>
            )}
            {side ? (
              <View style={[styles.sideNote, { backgroundColor: placementStyle[side].tint }]}>
                <Icon
                  name={side === "LEFT" ? "arrow_back" : "arrow_forward"}
                  size={18}
                  color={placementStyle[side].accent}
                />
                <Text maxFontSizeMultiplier={1.3} style={styles.sideNoteText}>
                  Occupies the {side} position under{" "}
                  {member.placement_parent?.name ?? "their parent"}.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </Card>

      <Card icon="handshake" title="Sponsor">
        {member.sponsor ? (
          <MemberCard
            member={member.sponsor}
            onPress={() => openMember(member.sponsor!.id)}
          />
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={styles.rootNote}>
            {member.is_root
              ? "You lead this team, so no sponsor is recorded."
              : "No sponsor was recorded for this member."}
          </Text>
        )}
      </Card>

      <Card icon="groups" title="Positions below">
        {childrenPending ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : childrenError ? (
          <ErrorState
            error={childrenError}
            title="We couldn't load these positions"
            onRetry={onRetryChildren}
          />
        ) : (
          <>
            <ChildSlot side="LEFT" member={left} parentId={member.id} />
            <ChildSlot side="RIGHT" member={right} parentId={member.id} />
          </>
        )}
      </Card>

      {/* Never offered for the leader's own record: the team hangs from it, and the
          backend refuses it regardless. Showing a button that always fails would be
          worse than not showing one. */}
      {member.is_root ? null : <DeleteMember member={member} />}
    </>
  );
}

/**
 * Permanently remove this member, once the user has said so explicitly.
 *
 * Which of two routes depends on whether anyone is placed below them, which this
 * screen already knows from the member's own record:
 *
 * - nobody below: the deletion is self-contained, so it is confirmed here in a dialog
 *   that names the member and says plainly that it cannot be undone. While the request
 *   is in flight the control is disabled, which is what stops a second deletion being
 *   sent. On success the screen is left behind — it describes a member who no longer
 *   exists — and the mutation invalidates the account's queries, so Home, Team, the
 *   counts and Recently Added all refresh without this screen arranging it.
 *
 * - someone below: a dialog is the wrong place for it. The leader has a choice to make
 *   and a plan to read, so the Delete Member screen takes over, and the backend
 *   calculates what would happen before anything is confirmed.
 *
 * The flags come from the member's record rather than from a guess, and the backend
 * decides regardless: an ordinary delete of a member with children is refused, which
 * the message below explains if the two ever disagree.
 */
function DeleteMember({ member }: { member: Member }) {
  const hasMembersBelow = member.has_left_child || member.has_right_child;
  const remove = useDeleteMember(member.id);
  const [failure, setFailure] = useState<string | null>(null);

  function confirm() {
    if (remove.isPending) return;
    setFailure(null);

    if (hasMembersBelow) {
      openDeleteMember(member.id);
      return;
    }

    Alert.alert(
      "Delete this member?",
      `Are you sure you want to permanently delete ${member.name} from your team? ` +
        "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete Member", style: "destructive", onPress: run },
      ],
    );
  }

  function run() {
    remove.mutate(undefined, {
      onSuccess: () => {
        // Back to wherever they came from — the team, a branch, or search.
        if (router.canGoBack()) router.back();
      },
      onError: (error) => {
        if (!isApiError(error)) {
          setFailure("We couldn't delete this member. Please try again.");
          return;
        }
        // A refusal this screen knows about reads as its real reason; anything else
        // falls back to the client's own message for that status.
        setFailure(deletionFailureMessage(error.code, error.userMessage));
      },
    });
  }

  return (
    <View style={styles.dangerZone}>
      <TouchableOpacity
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${member.name}`}
        accessibilityHint={
          hasMembersBelow
            ? "Shows how your team would be reorganized before you confirm"
            : "Asks you to confirm before permanently deleting this member"
        }
        accessibilityState={{ busy: remove.isPending, disabled: remove.isPending }}
        disabled={remove.isPending}
        onPress={confirm}
        style={styles.deleteButton}
      >
        {remove.isPending ? (
          <ActivityIndicator color={colors.semantic.error} />
        ) : (
          <>
            <Icon name="delete" size={22} color={colors.semantic.error} />
            <Text maxFontSizeMultiplier={1.3} style={styles.deleteLabel}>
              Delete Member
            </Text>
          </>
        )}
      </TouchableOpacity>

      <Text maxFontSizeMultiplier={1.3} style={styles.deleteNote}>
        {hasMembersBelow
          ? "This member has members placed below them. You'll see exactly how your team " +
            "would be reorganized, and nothing changes until you confirm."
          : "Permanently removes this member from your team."}
      </Text>

      {failure ? (
        <Text accessibilityLiveRegion="polite" style={styles.deleteError}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

/** A member's own LEFT or RIGHT position: who is in it, or a way to fill it. */
function ChildSlot({
  side,
  member,
  parentId,
}: {
  side: PlacementPosition;
  member: MemberSummary | null;
  parentId: string;
}) {
  const { accent, tint, label } = placementStyle[side];

  if (member) {
    return (
      <View style={styles.slot}>
        <Text allowFontScaling={false} style={[styles.slotLabel, { color: accent }]}>
          {label}
        </Text>
        <MemberCard member={member} side={side} onPress={() => openMember(member.id)} />
      </View>
    );
  }

  return (
    <View style={styles.slot}>
      <Text allowFontScaling={false} style={[styles.slotLabel, { color: accent }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add a member to the ${label} position`}
        onPress={() => openAddMember(parentId, side)}
        style={({ pressed }) => [
          styles.emptySlot,
          { borderColor: `${accent}66`, backgroundColor: tint },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="person_add" size={20} color={accent} />
        <Text maxFontSizeMultiplier={1.2} style={styles.emptySlotText}>
          Open — tap to add a member
        </Text>
      </Pressable>
    </View>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Icon name={icon} size={20} color={colors.brand.indigo} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.cardTitle}>
          {title}
        </Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  multiline = false,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  const recorded = Boolean(value);

  return (
    <View style={styles.infoRow}>
      <Icon name={icon} size={18} color={colors.ui.icon} />
      <View style={styles.infoText}>
        <Text maxFontSizeMultiplier={1.3} style={styles.label}>
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={multiline ? undefined : 2}
          style={[styles.value, !recorded && styles.valueMissing]}
        >
          {value ?? NOT_RECORDED}
        </Text>
      </View>
    </View>
  );
}

function LoadingMember() {
  return (
    <View style={styles.loading}>
      <Skeleton height={168} corner={radius.xl} />
      <Skeleton height={190} corner={radius.xl} />
      <Skeleton height={140} corner={radius.xl} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ui.screen,
  },
  content: {
    gap: spacing.base,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loading: {
    gap: spacing.base,
  },
  pressed: {
    opacity: 0.85,
  },
  headerCard: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.brand.purple}33`,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 4px 16px ${colors.brand.indigo}14`,
  },
  headerName: {
    ...typography.h2,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rootBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  rootBadgeLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.6,
    color: colors.interaction.primary,
  },
  card: {
    gap: spacing.md,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  cardBody: {
    gap: spacing.md,
  },
  cardLabel: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.ui.textSecondary,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  infoText: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  value: {
    ...typography.bodyMedium,
    fontFamily: fontFamily.medium,
    color: colors.ui.textPrimary,
  },
  valueMissing: {
    fontFamily: fontFamily.regular,
    color: colors.ui.textSecondary,
  },
  rootNote: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
  },
  sideNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  sideNoteText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textPrimary,
  },
  slot: {
    gap: spacing.sm,
  },
  slotLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
  },
  emptySlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: radius.lg,
  },
  emptySlotText: {
    ...typography.bodyMedium,
    flex: 1,
    fontFamily: fontFamily.medium,
    color: colors.ui.textPrimary,
  },
  dangerZone: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  deleteButton: {
    height: componentTokens.button.height,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    borderColor: `${colors.semantic.error}66`,
    backgroundColor: statusColors.error.background,
  },
  deleteLabel: {
    ...componentTokens.button.typography,
    fontFamily: fontFamily.semiBold,
    color: statusColors.error.text,
  },
  deleteNote: {
    ...typography.bodySmall,
    textAlign: "center",
    color: colors.ui.textSecondary,
  },
  deleteError: {
    ...typography.bodySmall,
    textAlign: "center",
    color: statusColors.error.text,
  },
});
