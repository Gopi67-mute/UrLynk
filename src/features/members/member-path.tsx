import { Stack, useLocalSearchParams } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MemberPlacementPath } from "@/api/members";
import { Avatar } from "@/components/avatar";
import { ErrorState } from "@/components/error-state";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/skeleton";
import { usePlacementPath } from "@/hooks/use-members";
import { initialsFor } from "@/lib/names";
import { openMember } from "@/lib/navigation";
import {
  colors,
  componentTokens,
  fontFamily,
  placementStyle,
  radius,
  spacing,
  typography,
} from "@/theme";
import { depthText, pathRows, pathSummary, type PathRow } from "./placement-path";

const CONNECTOR_COLOR = colors.ui.borderStrong;
const FACE_SIZE = 44;

/**
 * Exactly how a member is connected to the leader at the root of the team.
 *
 * The chain comes from the backend, which walks the real placement relationships in
 * PostgreSQL — one request for the whole path, never one per ancestor, and never a
 * download of the tree. Nothing here infers a path from registration order, identifiers
 * or dates; this screen draws what the database said.
 *
 * Laid out vertically, one member per row, because a phone screen cannot hold a tree
 * sideways and a path with forty steps has to stay readable. Every row above the member
 * opens that member, so the path doubles as a way back up the team.
 */
export default function MemberPathScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = usePlacementPath(id);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Placement Path" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={path.isRefetching}
            onRefresh={() => void path.refetch()}
            colors={[colors.interaction.primary]}
            tintColor={colors.interaction.primary}
          />
        }
      >
        {path.isPending ? (
          <LoadingPath />
        ) : path.isError ? (
          <ErrorState
            error={path.error}
            title="We couldn't work out this member's path"
            onRetry={() => void path.refetch()}
            isRetrying={path.isFetching}
          />
        ) : (
          <LoadedPath path={path.data} />
        )}
      </ScrollView>
    </View>
  );
}

function LoadedPath({ path }: { path: MemberPlacementPath }) {
  const rows = pathRows(path.steps);

  return (
    <>
      <View style={styles.summaryCard}>
        <Text maxFontSizeMultiplier={1.3} style={styles.summaryLabel}>
          Placement path to
        </Text>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={styles.summaryName}>
          {path.member.name}
        </Text>
        <View style={styles.summaryDepth}>
          <Icon name="account_tree" size={16} color={colors.interaction.primary} />
          <Text maxFontSizeMultiplier={1.3} style={styles.summaryDepthText}>
            {depthText(path.depth)}
          </Text>
        </View>
        {/* The same steps the rows below are built from, in one line, so the shape of
            the path is readable before scrolling it. */}
        <Text maxFontSizeMultiplier={1.2} style={styles.summaryChain}>
          {pathSummary(path.steps)}
        </Text>
      </View>

      <View style={styles.path}>
        {rows.map((row, index) => (
          <PathNode key={row.id} row={row} isLast={index === rows.length - 1} />
        ))}
      </View>

      <Text maxFontSizeMultiplier={1.3} style={styles.note}>
        Every step is a real placement in your team. Tap any member above to open their
        details.
      </Text>
    </>
  );
}

/**
 * One member on the path, with the line down to the next.
 *
 * The badge on the left states what that step *is*: ROOT for the leader, otherwise the
 * side this member occupies under the row above them. That is the member's own stored
 * position, so the label and the structure cannot disagree.
 */
function PathNode({ row, isLast }: { row: PathRow; isLast: boolean }) {
  const side = row.isRoot ? null : (row.badge as "LEFT" | "RIGHT");
  const accent = side ? placementStyle[side].accent : colors.interaction.primary;
  const tint = side ? placementStyle[side].tint : colors.interaction.primaryLight;

  return (
    <View style={styles.node}>
      <View style={styles.rail}>
        <View style={[styles.railDot, { backgroundColor: accent }]} />
        {isLast ? null : <View style={styles.railLine} />}
      </View>

      <View style={styles.nodeBody}>
        <View style={[styles.badge, { backgroundColor: accent }]}>
          <Text allowFontScaling={false} style={styles.badgeLabel}>
            {row.badge}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.accessibilityLabel}
          accessibilityHint={row.accessibilityHint}
          accessibilityState={{ disabled: row.isTarget, selected: row.isTarget }}
          disabled={row.isTarget}
          onPress={() => openMember(row.id)}
          style={({ pressed }) => [
            styles.card,
            row.isTarget && { borderColor: accent, borderWidth: 2, backgroundColor: tint },
            pressed && styles.pressed,
          ]}
        >
          <Avatar
            size={FACE_SIZE}
            initials={initialsFor(row.name)}
            imageUri={null}
            ringColor={tint}
          />

          <View style={styles.cardText}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.name}>
              {row.name}
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.caption}>
              {row.caption}
            </Text>
          </View>

          {row.isTarget ? (
            <View style={[styles.herePill, { backgroundColor: accent }]}>
              <Text allowFontScaling={false} style={styles.herePillLabel}>
                THIS MEMBER
              </Text>
            </View>
          ) : (
            <Icon name="chevron_right" size={22} color={colors.ui.icon} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function LoadingPath() {
  return (
    <View style={styles.loading}>
      <Skeleton height={130} corner={radius.xl} />
      <Skeleton height={76} corner={radius.lg} />
      <Skeleton height={76} corner={radius.lg} />
      <Skeleton height={76} corner={radius.lg} />
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
  summaryCard: {
    gap: spacing.xs,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.brand.purple}33`,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 4px 16px ${colors.brand.indigo}14`,
  },
  summaryLabel: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  summaryName: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  summaryDepth: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  summaryDepthText: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.interaction.primary,
  },
  summaryChain: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.ui.border,
    color: colors.ui.textSecondary,
  },
  path: {
    gap: 0,
  },
  node: {
    flexDirection: "row",
    gap: spacing.md,
  },
  // The vertical line connecting the steps, with a dot at each one.
  rail: {
    width: 12,
    alignItems: "center",
    paddingTop: spacing.base,
  },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  railLine: {
    flex: 1,
    width: 2,
    minHeight: spacing.base,
    backgroundColor: CONNECTOR_COLOR,
  },
  nodeBody: {
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.neutral.white,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  caption: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  herePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  herePillLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.6,
    color: colors.neutral.white,
  },
  note: {
    ...typography.bodySmall,
    textAlign: "center",
    color: colors.ui.textSecondary,
  },
});
