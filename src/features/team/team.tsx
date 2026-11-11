import { StyleSheet, Text, View } from "react-native";
import { useAccountProfile } from "@/auth/account";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { PageHeader, TabScreen } from "@/components/tab-screen";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

const CONNECTOR_COLOR = colors.ui.borderStrong;
const BRANCH_GAP = spacing.md;

/**
 * The shape of the binary structure: the leader at the root with one LEFT and
 * one RIGHT branch. Branch contents load from the backend in a later phase.
 */
export default function Team() {
  const account = useAccountProfile();

  return (
    <TabScreen>
      <PageHeader
        title="My Team"
        subtitle="Your LEFT and RIGHT team structure"
      />

      <View>
        <View style={styles.rootCard}>
          <Avatar
            size={52}
            initials={account.initials}
            imageUrl={account.imageUrl}
            ringColor={colors.interaction.primaryLight}
          />
          <View style={styles.rootText}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rootName}>
              {account.displayName}
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.rootRole}>
              You • Team Leader
            </Text>
          </View>
        </View>

        {/* Line from the leader down to the bar joining both branches. */}
        <View style={styles.connectorStem} />

        <View style={styles.branchRow}>
          <BranchSlot
            side="left"
            label="LEFT"
            accent={colors.brand.green}
            tint={statusColors.success.background}
          />
          <BranchSlot
            side="right"
            label="RIGHT"
            accent={colors.brand.blue}
            tint={statusColors.info.background}
          />
        </View>
      </View>

      <EmptyState
        icon="account_tree"
        title="Team structure isn't connected yet"
        message="Members, sponsors and LEFT/RIGHT placements will appear here once team management is available."
      />
    </TabScreen>
  );
}

function BranchSlot({
  side,
  label,
  accent,
  tint,
}: {
  side: "left" | "right";
  label: string;
  accent: string;
  tint: string;
}) {
  return (
    <View style={styles.branchColumn}>
      {/* Each branch draws its half of the bar, from its center to the row's center. */}
      <View
        style={[
          styles.connectorHalfBar,
          side === "left" ? styles.connectorHalfBarLeft : styles.connectorHalfBarRight,
        ]}
      />
      <View style={styles.connectorDrop} />
      <View
        accessible
        accessibilityLabel={`${label} branch: no members loaded`}
        style={[styles.branchSlot, { borderColor: `${accent}80`, backgroundColor: tint }]}
      >
        <View style={[styles.branchPill, { backgroundColor: accent }]}>
          <Text allowFontScaling={false} style={styles.branchPillLabel}>
            {label}
          </Text>
        </View>
        <Icon name="groups" size={36} color={accent} />
        <Text maxFontSizeMultiplier={1.2} style={styles.branchMeta}>
          No members loaded
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderStyle: "dashed",
    borderRadius: radius.xl,
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
  branchMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
});
