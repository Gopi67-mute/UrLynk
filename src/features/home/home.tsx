import { router } from "expo-router";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAccountProfile } from "@/auth/account";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Icon, type IconName } from "@/components/icon";
import { SectionHeader, SectionLink } from "@/components/section-header";
import { TabScreen } from "@/components/tab-screen";
import {
  colors,
  componentTokens,
  fontFamily,
  gradients,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

const LOGO_ASPECT_RATIO = 2172 / 724;
const LOGO_WIDTH = 100;

/**
 * Team numbers come from the backend, which arrives in a later phase. Until
 * then every figure shows this mark, never a made-up value.
 */
const UNAVAILABLE_VALUE = "—";

type Branch = "left" | "right";

const BRANCH_STYLE: Record<
  Branch,
  { label: string; title: string; accent: string; tint: string }
> = {
  left: {
    label: "LEFT",
    title: "Left Team",
    accent: colors.brand.green,
    tint: statusColors.success.background,
  },
  right: {
    label: "RIGHT",
    title: "Right Team",
    accent: colors.brand.blue,
    tint: statusColors.info.background,
  },
};

function openTeam() {
  router.navigate("/team");
}

function openSearch() {
  router.navigate("/search");
}

export default function Home() {
  const account = useAccountProfile();

  return (
    <TabScreen>
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
          onPress={() => router.navigate("/settings")}
          hitSlop={spacing.xs}
        >
          <Avatar
            size={40}
            initials={account.initials}
            imageUrl={account.imageUrl}
            ringColor={colors.interaction.primaryLight}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.leaderCard}>
        <Icon
          name="trending_up"
          size={96}
          color={`${colors.neutral.white}33`}
          style={styles.leaderCardArt}
        />
        <Avatar size={64} initials={account.initials} imageUrl={account.imageUrl} />
        <View style={styles.leaderText}>
          <Text maxFontSizeMultiplier={1.2} style={styles.welcome}>
            Welcome back,
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={styles.leaderName}
          >
            {account.displayName}
          </Text>
          <View style={styles.roleRow}>
            <Icon name="verified_user" size={18} color={colors.semantic.success} />
            <Text maxFontSizeMultiplier={1.2} style={styles.roleLabel}>
              Team Leader
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.statsBlock}>
        <View style={styles.statsRow}>
          <StatCard
            label="Total Members"
            accent={colors.interaction.primary}
            tint={colors.interaction.primaryLight}
          />
          <StatCard
            label="Left Team"
            accent={BRANCH_STYLE.left.accent}
            tint={BRANCH_STYLE.left.tint}
          />
          <StatCard
            label="Right Team"
            accent={BRANCH_STYLE.right.accent}
            tint={BRANCH_STYLE.right.tint}
          />
        </View>
        <View style={styles.dataNotice}>
          <Icon name="info" size={16} color={colors.ui.textSecondary} />
          <Text maxFontSizeMultiplier={1.3} style={styles.dataNoticeText}>
            Team totals will appear once your team data is connected.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          icon="account_tree"
          title="My Team"
          accessory={<SectionLink label="View All" onPress={openTeam} />}
        />
        <View style={styles.pairRow}>
          <BranchCard branch="left" />
          <BranchCard branch="right" />
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
            subtitle="Available soon"
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

      <View style={styles.section}>
        <SectionHeader icon="monitor_heart" title="Recent Team Activity" />
        <EmptyState
          icon="history"
          title="No activity to show yet"
          message="Real team events, such as new registrations and sync updates, will be listed here."
        />
      </View>
    </TabScreen>
  );
}

function StatCard({
  label,
  accent,
  tint,
}: {
  label: string;
  accent: string;
  tint: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: not available yet`}
      style={[styles.statCard, { backgroundColor: tint, borderColor: `${accent}33` }]}
    >
      <Icon name="groups" size={30} color={accent} />
      <Text maxFontSizeMultiplier={1.2} style={styles.statValue}>
        {UNAVAILABLE_VALUE}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.2}
        style={styles.statLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function BranchCard({ branch }: { branch: Branch }) {
  const { label, title, accent, tint } = BRANCH_STYLE[branch];

  return (
    <View
      style={[
        styles.branchCard,
        {
          borderColor: `${accent}80`,
          backgroundImage: `linear-gradient(180deg, ${tint}, ${colors.ui.surface})`,
        },
      ]}
    >
      <View style={[styles.branchPill, { backgroundColor: accent }]}>
        <Text allowFontScaling={false} style={styles.branchPillLabel}>
          {label}
        </Text>
      </View>
      <Icon name="groups" size={40} color={accent} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchTitle}>
        {title}
      </Text>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
        Not connected yet
      </Text>
      <TouchableOpacity
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Explore ${title}`}
        onPress={openTeam}
        style={[styles.branchButton, { backgroundColor: accent }]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.2}
          style={styles.branchButtonLabel}
        >
          Explore Team
        </Text>
        <Icon name="arrow_forward" size={18} color={colors.neutral.white} />
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
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  roleLabel: {
    ...typography.bodyMedium,
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
  statCard: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  statValue: {
    ...typography.h2,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  statLabel: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
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
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.xl,
    backgroundColor: colors.ui.surface,
    boxShadow: cardShadow,
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
