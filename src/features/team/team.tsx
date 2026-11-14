import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MemberSummary } from "@/api/members";
import type { TeamOverview } from "@/api/teams";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FreshnessNotice } from "@/components/freshness-notice";
import { Icon } from "@/components/icon";
import { EmptyFace, MemberFace } from "@/components/member-face";
import { Skeleton, SkeletonCard } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { PageHeader, TabScreen } from "@/components/tab-screen";
import { branchView } from "@/features/team/branch-view";
import { useLeaderProfile } from "@/hooks/use-leader-profile";
import { useMemberChildren } from "@/hooks/use-members";
import { useScreenStatus } from "@/hooks/use-screen-state";
import { useTeamOverview } from "@/hooks/use-team";
import { initialsFor } from "@/lib/names";
import { openAddMember, openMember } from "@/lib/navigation";
import { worseOf, type ScreenState } from "@/lib/screen-state";
import { slotStateFor, type SlotState } from "@/lib/slot-state";
import {
  colors,
  componentTokens,
  fontFamily,
  placementStyle,
  radius,
  spacing,
  typography,
  type PlacementSide,
} from "@/theme";

const CONNECTOR_COLOR = colors.ui.borderStrong;
const BRANCH_GAP = spacing.md;

/**
 * The team as a structure: the leader at the root, with their LEFT and RIGHT
 * positions either filled or open.
 *
 * Two requests, both small: the team overview (with its counts, computed in the
 * database) and the root's two direct members. No subtree is ever downloaded.
 */
export default function Team() {
  const overview = useTeamOverview();
  const leader = useLeaderProfile();
  const rootId = overview.data?.root_member.id;
  const children = useMemberChildren(rootId);

  // The same two requests Home reads, from the same cache entries — so opening one
  // after the other costs nothing, and the two screens cannot disagree about a position.
  const team = useScreenStatus(overview);
  const slots = useScreenStatus(children);
  const branchState = worseOf(team.state, slots.state);

  function refresh() {
    void overview.refetch();
    if (rootId) void children.refetch();
  }

  return (
    <TabScreen
      refreshing={overview.isRefetching || children.isRefetching}
      onRefresh={refresh}
    >
      {/* The team label is the same derived one Home shows, so the two can never
          disagree about what the leader's team is called. */}
      <PageHeader
        title="My Team"
        subtitle={leader.teamName ?? "Your LEFT and RIGHT team structure"}
      />

      <FreshnessNotice state={branchState} updatedAt={team.updatedAt} />

      {/* A team saved on this device is drawn from the cache immediately; the skeleton
          below belongs only to a leader who has never loaded it here. A refresh happens
          underneath the tree rather than in place of it. */}
      {overview.data ? (
        <LoadedTeam
          overview={overview.data}
          left={children.data?.left ?? null}
          right={children.data?.right ?? null}
          branchState={branchState}
          childrenError={slots.state === "failed" ? children.error : null}
          onRetryChildren={() => void children.refetch()}
        />
      ) : team.state === "offline-empty" ? (
        <EmptyState
          icon="wifi_off"
          title="Your team isn't on this device yet"
          message="Connect to the internet once and your team structure will be here the next time you open UrLynk, with or without a connection."
        />
      ) : team.state === "failed" ? (
        <ErrorState
          error={overview.error}
          title="We couldn't load your team"
          onRetry={refresh}
          isRetrying={overview.isFetching}
        />
      ) : (
        <LoadingTeam />
      )}
    </TabScreen>
  );
}

function LoadedTeam({
  overview,
  left,
  right,
  branchState,
  childrenError,
  onRetryChildren,
}: {
  overview: TeamOverview;
  left: MemberSummary | null;
  right: MemberSummary | null;
  branchState: ScreenState;
  childrenError: unknown;
  onRetryChildren: () => void;
}) {
  const { root_member: root, counts } = overview;

  return (
    <>
      <View>
        <LeaderCard memberId={root.id} name={root.name} />

        {/* Line from the leader down to the bar joining both branches. */}
        <View style={styles.connectorStem} />

        <View style={styles.branchRow}>
          <BranchSlot
            side="LEFT"
            member={left}
            sideTotal={counts.left_members}
            state={slotStateFor(branchState, left)}
            rootId={root.id}
          />
          <BranchSlot
            side="RIGHT"
            member={right}
            sideTotal={counts.right_members}
            state={slotStateFor(branchState, right)}
            rootId={root.id}
          />
        </View>
      </View>

      {childrenError ? (
        <ErrorState
          error={childrenError}
          title="We couldn't load your LEFT and RIGHT members"
          onRetry={onRetryChildren}
        />
      ) : null}

      <View style={styles.statsRow}>
        <StatTile
          label="Total Members"
          value={counts.total_members}
          accent={colors.interaction.primary}
          tint={colors.interaction.primaryLight}
        />
        <StatTile
          label="Left Team"
          value={counts.left_members}
          accent={placementStyle.LEFT.accent}
          tint={placementStyle.LEFT.tint}
        />
        <StatTile
          label="Right Team"
          value={counts.right_members}
          accent={placementStyle.RIGHT.accent}
          tint={placementStyle.RIGHT.tint}
        />
      </View>

      <View style={styles.actions}>
        <Button
          label="Add Member"
          icon="person_add"
          onPress={() => openAddMember()}
          accessibilityHint="Register a member and choose where they sit in your team"
        />
        <Text maxFontSizeMultiplier={1.3} style={styles.actionsNote}>
          {counts.total_members === 1
            ? "Your team is ready. Add your first member to either position."
            : "Totals include every member below you, at any depth."}
        </Text>
      </View>
    </>
  );
}

/**
 * The leader at the root of the team.
 *
 * `name` is the root member's own — the preferred name saved in UrLynk, the same value
 * Home shows — and the photo comes from the same record, so the two screens cannot
 * present the leader differently. Tapping it opens the leader's profile, which is the
 * same member screen as any other position on this tree.
 */
function LeaderCard({ memberId, name }: { memberId: string; name: string }) {
  const leader = useLeaderProfile();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, you, team leader, root position`}
      accessibilityHint="Opens your profile"
      onPress={() => openMember(memberId)}
      style={({ pressed }) => [styles.rootCard, pressed && styles.pressed]}
    >
      <Avatar
        size={52}
        initials={initialsFor(name)}
        imageUri={leader.photoUri}
        ringColor={colors.interaction.primaryLight}
      />
      <View style={styles.rootText}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rootName}>
          {name}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={styles.rootRole}>
          You • Team Leader
        </Text>
      </View>
      <View style={styles.rootBadge}>
        <Icon name="verified_user" size={16} color={colors.interaction.primary} />
        <Text allowFontScaling={false} style={styles.rootBadgeLabel}>
          ROOT
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.ui.icon} />
    </Pressable>
  );
}

/**
 * One of the root's two positions: the member in it, or an invitation to fill it.
 *
 * The words come from `branchView`, the same function the dashboard's branch cards use,
 * so the same position cannot be described differently on the two screens. `sideTotal`
 * is the whole branch from the overview's recursive count; the card states how many of
 * those sit *below* the member it names.
 */
function BranchSlot({
  side,
  member,
  sideTotal,
  state,
  rootId,
}: {
  side: PlacementSide;
  member: MemberSummary | null;
  sideTotal: number;
  state: SlotState;
  rootId: string;
}) {
  const { accent, tint } = placementStyle[side];
  const view = branchView({ side, member, sideTotal, state, rootId });
  const filled = state === "filled" && member !== null;
  const loading = state === "loading";
  const unavailable = state === "unavailable";

  function enter() {
    const action = view.action;
    if (action.kind === "member") {
      openMember(action.memberId);
    } else if (action.kind === "add") {
      openAddMember(action.parentId, action.position);
    }
  }

  return (
    <View style={styles.branchColumn}>
      {/* Each branch draws its half of the bar, from its center to the row's center. */}
      <View
        style={[
          styles.connectorHalfBar,
          side === "LEFT" ? styles.connectorHalfBarLeft : styles.connectorHalfBarRight,
        ]}
      />
      <View style={styles.connectorDrop} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.accessibilityLabel}
        accessibilityHint={view.accessibilityHint}
        onPress={enter}
        disabled={view.action.kind === "none"}
        style={({ pressed }) => [
          styles.branchSlot,
          {
            borderColor: unavailable ? colors.ui.border : `${accent}80`,
            backgroundColor: unavailable ? colors.neutral.gray50 : tint,
            borderStyle: filled ? "solid" : "dashed",
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.branchPill, { backgroundColor: accent }]}>
          <Text allowFontScaling={false} style={styles.branchPillLabel}>
            {view.label}
          </Text>
        </View>

        {loading ? (
          <View style={styles.branchLoading}>
            <Skeleton width={44} height={44} corner={radius.pill} />
            <Skeleton width="80%" height={14} />
          </View>
        ) : (
          <>
            <View style={styles.branchFace}>
              {unavailable ? (
                <EmptyFace size={44}>
                  <Icon name="cloud_off" size={22} color={colors.ui.icon} />
                </EmptyFace>
              ) : filled && member ? (
                /* The member's own photograph, with their initials as the fallback. */
                <MemberFace member={member} size={44} side={side} />
              ) : (
                <EmptyFace size={44}>
                  <Icon name="person_add" size={24} color={accent} />
                </EmptyFace>
              )}
            </View>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.branchName}>
              {view.title}
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
              {filled ? view.meta : unavailable ? view.meta : "Tap to add"}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function LoadingTeam() {
  return (
    <View style={styles.loading}>
      <SkeletonCard />
      <View style={styles.branchRow}>
        <View style={styles.branchColumn}>
          <Skeleton height={150} corner={radius.xl} />
        </View>
        <View style={styles.branchColumn}>
          <Skeleton height={150} corner={radius.xl} />
        </View>
      </View>
      <View style={styles.statsRow}>
        <Skeleton height={86} corner={radius.lg} />
        <Skeleton height={86} corner={radius.lg} />
        <Skeleton height={86} corner={radius.lg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    gap: spacing.xl,
  },
  pressed: {
    opacity: 0.85,
  },
  rootCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.brand.purple}40`,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 4px 16px ${colors.brand.indigo}14`,
  },
  rootText: {
    flex: 1,
    gap: 2,
  },
  rootName: {
    ...typography.h4,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  rootRole: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.interaction.primary,
  },
  rootBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
  connectorStem: {
    alignSelf: "center",
    width: 2,
    height: spacing.base,
    backgroundColor: CONNECTOR_COLOR,
  },
  branchRow: {
    flexDirection: "row",
    gap: BRANCH_GAP,
  },
  connectorHalfBar: {
    position: "absolute",
    top: 0,
    height: 2,
    backgroundColor: CONNECTOR_COLOR,
  },
  connectorHalfBarLeft: {
    left: "50%",
    right: -BRANCH_GAP / 2,
  },
  connectorHalfBarRight: {
    left: -BRANCH_GAP / 2,
    right: "50%",
  },
  branchColumn: {
    flex: 1,
    alignItems: "center",
  },
  connectorDrop: {
    width: 2,
    height: spacing.base,
    backgroundColor: CONNECTOR_COLOR,
  },
  branchSlot: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.xl,
  },
  branchLoading: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  branchFace: {
    marginTop: spacing.xs,
  },
  branchPill: {
    paddingHorizontal: spacing.base,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  branchPillLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: colors.neutral.white,
  },
  branchName: {
    ...typography.bodyMedium,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  branchMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
  actionsNote: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
});
