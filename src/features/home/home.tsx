import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { MemberSummary } from "@/api/members";
import { Avatar } from "@/components/avatar";
import { ErrorState } from "@/components/error-state";
import { Icon, type IconName } from "@/components/icon";
import { SectionHeader, SectionLink } from "@/components/section-header";
import { Skeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { TabScreen } from "@/components/tab-screen";
import { useLeaderProfile } from "@/hooks/use-leader-profile";
import { useMemberChildren } from "@/hooks/use-members";
import { useTeamOverview } from "@/hooks/use-team";
import { initialsFor } from "@/lib/names";
import {
  openAddMember,
  openMember,
  openSearch,
  openSettings,
  openTeam,
} from "@/lib/navigation";
import { slotState, type SlotState } from "@/lib/slot-state";
import {
  colors,
  componentTokens,
  fontFamily,
  gradients,
  placementStyle,
  radius,
  spacing,
  statusColors,
  typography,
  type PlacementSide,
} from "@/theme";
import { RecentlyAdded } from "./recently-added";

const LOGO_ASPECT_RATIO = 2172 / 724;
const LOGO_WIDTH = 100;

/**
 * The dashboard.
 *
 * The shell — logo, leader card, section layout — renders without waiting on the
 * network. The team numbers fill in from the same cached query the Team screen uses,
 * and say plainly when they are not available.
 *
 * The leader's name and photo come from `useLeaderProfile`, which reads the root
 * member record. That is the same source the Team screen uses, so the two can never
 * disagree, and it is the leader's own preferred name rather than whatever name their
 * Google account happens to carry.
 */
export default function Home() {
  const leader = useLeaderProfile();
  const overview = useTeamOverview();
  const rootId = overview.data?.root_member.id;
  const children = useMemberChildren(rootId);

  const counts = overview.data?.counts ?? null;
  // The branch cards depend on both requests: the overview supplies the root, and the
  // children request supplies who holds each position.
  const branchPending = overview.isPending || children.isPending;
  const branchError = overview.error ?? children.error;

  function refresh() {
    void overview.refetch();
    if (rootId) void children.refetch();
  }

  return (
    <TabScreen refreshing={overview.isRefetching || children.isRefetching} onRefresh={refresh}>
      <View style={styles.header}>
        <Image
          source={require("../../../assets/images/logoAlone.png")}
          style={styles.logo}
          resizeMode="contain"
          fadeDuration={0}
          accessibilityRole="image"
          accessibilityLabel="UrLynk"
        />
        <View style={styles.headerDivider} />
        <View style={styles.headerText}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.2}
            style={styles.headerTitle}
          >
            Team Growth
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.2}
            style={styles.headerSubtitle}
          >
            Grow Together • Achieve More
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open account settings"
          onPress={openSettings}
          hitSlop={spacing.xs}
        >
          {/* The same photo as the welcome card below: one canonical value, read once. */}
          <Avatar
            size={40}
            initials={leader.initials}
            imageUri={leader.photoUri}
            ringColor={colors.interaction.primaryLight}
          />
        </TouchableOpacity>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${leader.displayName}, Team Leader`}
        accessibilityHint="Opens your profile"
        accessibilityState={{ disabled: !leader.memberId }}
        disabled={!leader.memberId}
        onPress={() => leader.memberId && openMember(leader.memberId)}
        style={({ pressed }) => [styles.leaderCard, pressed && styles.pressed]}
      >
        <Icon
          name="trending_up"
          size={96}
          color={`${colors.neutral.white}33`}
          style={styles.leaderCardArt}
        />
        <Avatar size={64} initials={leader.initials} imageUri={leader.photoUri} />
        <View style={styles.leaderText}>
          <Text maxFontSizeMultiplier={1.2} style={styles.welcome}>
            Welcome back,
          </Text>
          {/* A placeholder, not the account name: showing that would flash the Google
              name before the saved preferred one on every cold start. */}
          {leader.isLoading ? (
            <View style={styles.leaderNameLoading}>
              <Skeleton width="70%" height={20} />
            </View>
          ) : (
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.leaderName}>
              {leader.displayName}
            </Text>
          )}
          <View style={styles.roleRow}>
            <Icon name="verified_user" size={18} color={colors.semantic.success} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.roleLabel}>
              {leader.teamName ?? "Team Leader"}
            </Text>
          </View>
        </View>
        {leader.memberId ? (
          <Icon name="chevron_right" size={24} color={`${colors.neutral.white}CC`} />
        ) : null}
      </Pressable>

      <View style={styles.statsBlock}>
        <View style={styles.statsRow}>
          <StatTile
            label="Total Members"
            value={counts?.total_members ?? null}
            loading={overview.isPending}
            accent={colors.interaction.primary}
            tint={colors.interaction.primaryLight}
          />
          <StatTile
            label="Left Team"
            value={counts?.left_members ?? null}
            loading={overview.isPending}
            accent={placementStyle.LEFT.accent}
            tint={placementStyle.LEFT.tint}
          />
          <StatTile
            label="Right Team"
            value={counts?.right_members ?? null}
            loading={overview.isPending}
            accent={placementStyle.RIGHT.accent}
            tint={placementStyle.RIGHT.tint}
          />
        </View>
        {overview.isError ? (
          <ErrorState
            error={overview.error}
            title="We couldn't load your team numbers"
            onRetry={refresh}
            isRetrying={overview.isFetching}
          />
        ) : counts ? (
          <View style={styles.dataNotice}>
            <Icon name="info" size={16} color={colors.ui.textSecondary} />
            <Text maxFontSizeMultiplier={1.3} style={styles.dataNoticeText}>
              Totals include you and every member below you, at any depth.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHeader
          icon="account_tree"
          title="My Team"
          accessory={<SectionLink label="View All" onPress={openTeam} />}
        />
        <View style={styles.pairRow}>
          <BranchCard
            side="LEFT"
            member={children.data?.left ?? null}
            size={counts?.left_members ?? null}
            state={slotState(branchPending, branchError, children.data?.left)}
            rootId={rootId}
          />
          <BranchCard
            side="RIGHT"
            member={children.data?.right ?? null}
            size={counts?.right_members ?? null}
            state={slotState(branchPending, branchError, children.data?.right)}
            rootId={rootId}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          icon="bolt"
          iconColor={colors.semantic.warning}
          title="Quick Access"
          accessory={
            <Text maxFontSizeMultiplier={1.2} style={styles.sectionCaption}>
              Essential Actions
            </Text>
          }
        />
        <View style={styles.pairRow}>
          <QuickAction
            icon="person_add"
            accent={colors.brand.green}
            tint={statusColors.success.background}
            title="Add Member"
            subtitle="Place a member LEFT or RIGHT"
            onPress={() => openAddMember()}
          />
          <QuickAction
            icon="search"
            accent={colors.brand.blue}
            tint={statusColors.info.background}
            title="Find Member"
            subtitle="Search by name or ID"
            onPress={openSearch}
          />
        </View>
      </View>

      <RecentlyAdded />
    </TabScreen>
  );
}

/**
 * One side of the team, as the dashboard shows it: who holds the position, how many
 * members sit under it, and a way in.
 *
 * The card's content is tappable in its own right — a filled position opens that
 * member, an open one opens Add Member with the parent and side already chosen. A
 * position whose state could not be loaded stays disabled and says so: drawing it as
 * open would invite a placement into a slot that may already be taken.
 */
function BranchCard({
  side,
  member,
  size,
  state,
  rootId,
}: {
  side: PlacementSide;
  member: MemberSummary | null;
  size: number | null;
  state: SlotState;
  rootId: string | undefined;
}) {
  const { label, title, accent, tint } = placementStyle[side];
  const loading = state === "loading";
  const unavailable = state === "unavailable";
  const open = state === "open";
  // An open position needs the root to place under; without it there is nothing to do.
  const interactive = !loading && !unavailable && (member !== null || Boolean(rootId));

  function enter() {
    if (member) {
      openMember(member.id);
    } else if (rootId) {
      openAddMember(rootId, side);
    }
  }

  return (
    <View
      style={[
        styles.branchCard,
        {
          borderColor: unavailable ? colors.ui.border : `${accent}80`,
          backgroundImage: unavailable
            ? undefined
            : `linear-gradient(180deg, ${tint}, ${colors.ui.surface})`,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          loading
            ? `${label} position, loading`
            : unavailable
              ? `${label} position, not available`
              : member
                ? `${label} position: ${member.name}`
                : `${label} position is open`
        }
        accessibilityHint={
          interactive
            ? member
              ? "Opens this member's details"
              : "Opens Add Member for this position"
            : undefined
        }
        accessibilityState={{ disabled: !interactive }}
        disabled={!interactive}
        onPress={enter}
        style={({ pressed }) => [styles.branchContent, pressed && interactive && styles.pressed]}
      >
        <View style={[styles.branchPill, { backgroundColor: accent }]}>
          <Text allowFontScaling={false} style={styles.branchPillLabel}>
            {label}
          </Text>
        </View>

        {loading ? (
          <View style={styles.branchLoading}>
            <Skeleton width={40} height={40} corner={radius.pill} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="55%" height={12} />
          </View>
        ) : unavailable ? (
          <>
            <View style={[styles.branchAvatar, styles.branchAvatarEmpty]}>
              <Icon name="cloud_off" size={20} color={colors.ui.icon} />
            </View>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchTitle}>
              Not available
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
              Pull to refresh
            </Text>
          </>
        ) : member ? (
          <>
            <View style={[styles.branchAvatar, { borderColor: `${accent}55` }]}>
              <Text allowFontScaling={false} style={[styles.branchInitials, { color: accent }]}>
                {initialsFor(member.name)}
              </Text>
            </View>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchTitle}>
              {member.name}
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
              {size === null ? title : `${size} ${size === 1 ? "member" : "members"}`}
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.branchAvatar, styles.branchAvatarEmpty]}>
              <Icon name="person_add" size={22} color={accent} />
            </View>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchTitle}>
              Open position
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
              No member yet
            </Text>
          </>
        )}
      </Pressable>

      <TouchableOpacity
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={open ? `Add a member to the ${label} position` : `Explore ${title}`}
        accessibilityState={{ disabled: loading || unavailable }}
        disabled={loading || unavailable}
        onPress={() => (open && rootId ? openAddMember(rootId, side) : openTeam())}
        style={[
          styles.branchButton,
          { backgroundColor: unavailable ? colors.ui.disabledBackground : accent },
          (loading || unavailable) && styles.unavailable,
        ]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.2}
          style={[styles.branchButtonLabel, unavailable && styles.branchButtonLabelDisabled]}
        >
          {unavailable ? "Unavailable" : open ? "Add Member" : "Explore Team"}
        </Text>
        <Icon
          name={unavailable ? "cloud_off" : open ? "person_add" : "arrow_forward"}
          size={18}
          color={unavailable ? colors.ui.disabledForeground : colors.neutral.white}
        />
      </TouchableOpacity>
    </View>
  );
}

function QuickAction({
  icon,
  accent,
  tint,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  accent: string;
  tint: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
}) {
  const isAvailable = Boolean(onPress);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ disabled: !isAvailable }}
      disabled={!isAvailable}
      onPress={onPress}
      style={[styles.quickCard, !isAvailable && styles.unavailable]}
    >
      <View style={styles.quickTopRow}>
        <View style={[styles.quickIcon, { backgroundColor: tint }]}>
          <Icon name={icon} size={26} color={accent} />
        </View>
        {isAvailable ? (
          <Icon name="chevron_right" size={22} color={colors.brand.indigo} />
        ) : null}
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.quickTitle}>
        {title}
      </Text>
      <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.quickSubtitle}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

const cardShadow = `0px 4px 16px ${colors.brand.indigo}0F`;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_WIDTH / LOGO_ASPECT_RATIO,
  },
  headerDivider: {
    width: 1.5,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    backgroundColor: colors.ui.borderStrong,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  headerSubtitle: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  leaderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
    padding: spacing.lg,
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: colors.brand.indigo,
    backgroundImage: `linear-gradient(110deg, ${gradients.bluePurple.start}, ${colors.brand.violet})`,
    boxShadow: `0px 10px 24px ${colors.brand.indigo}40`,
  },
  pressed: {
    opacity: 0.88,
  },
  leaderCardArt: {
    position: "absolute",
    right: spacing.sm,
    bottom: -spacing.sm,
  },
  leaderText: {
    flex: 1,
    gap: 2,
  },
  welcome: {
    ...typography.bodyMedium,
    color: `${colors.neutral.white}CC`,
  },
  leaderName: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.neutral.white,
  },
  // Matches the name line's height, so the card does not resize once it loads.
  leaderNameLoading: {
    height: typography.h3.lineHeight,
    justifyContent: "center",
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  roleLabel: {
    ...typography.bodyMedium,
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    color: colors.neutral.white,
  },
  statsBlock: {
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  dataNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dataNoticeText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textSecondary,
  },
  section: {
    gap: spacing.md,
  },
  sectionCaption: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.brand.indigo,
  },
  pairRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  branchCard: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.xl,
    backgroundColor: colors.ui.surface,
    boxShadow: cardShadow,
  },
  // The tappable part of the card: everything above the action button.
  branchContent: {
    alignItems: "center",
    gap: spacing.xs,
  },
  branchLoading: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  branchAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral.white,
  },
  branchAvatarEmpty: {
    borderStyle: "dashed",
    borderColor: colors.ui.borderStrong,
  },
  branchInitials: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
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
  branchTitle: {
    ...typography.h4,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  branchMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  branchButton: {
    alignSelf: "stretch",
    height: 44,
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  branchButtonLabel: {
    ...typography.bodyMedium,
    flexShrink: 1,
    fontFamily: fontFamily.semiBold,
    color: colors.neutral.white,
  },
  branchButtonLabelDisabled: {
    color: colors.ui.disabledForeground,
  },
  quickCard: {
    flex: 1,
    gap: 2,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: cardShadow,
  },
  unavailable: {
    opacity: 0.6,
  },
  quickTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  quickIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  quickTitle: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  quickSubtitle: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
});
