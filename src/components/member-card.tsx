import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MemberSummary } from "@/api/members";
import { Icon } from "@/components/icon";
import { MemberFace } from "@/components/member-face";
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

/** The LEFT or RIGHT pill, the same shape wherever a placement is shown. */
export function PlacementBadge({ side, small = false }: { side: PlacementSide; small?: boolean }) {
  const { label, accent } = placementStyle[side];
  return (
    <View style={[styles.badge, small && styles.badgeSmall, { backgroundColor: accent }]}>
      <Text allowFontScaling={false} style={[styles.badgeLabel, small && styles.badgeLabelSmall]}>
        {label}
      </Text>
    </View>
  );
}

/** A member's identifier, or a plain note that none was recorded. */
function MemberIdLine({ member }: { member: MemberSummary }) {
  return (
    <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.meta}>
      {member.mi_lifestyle_id ? `ID ${member.mi_lifestyle_id}` : "No Mi Lifestyle ID"}
    </Text>
  );
}

/**
 * One member, as a tappable card.
 *
 * `side` tints the avatar to match the branch it belongs to; the badge is only drawn
 * when the member's own placement is worth repeating.
 */
export function MemberCard({
  member,
  onPress,
  side,
  showBadge = false,
  trailing,
}: {
  member: MemberSummary;
  onPress?: () => void;
  side?: PlacementSide;
  showBadge?: boolean;
  trailing?: React.ReactNode;
}) {
  const position = member.placement_position;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${member.name}${position ? `, ${position} placement` : ""}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && onPress && styles.pressed]}
    >
      {/* The member's photograph when they have one, their initials when they do not. */}
      <MemberFace member={member} size={44} side={side} />

      <View style={styles.body}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.name}>
          {member.name}
        </Text>
        <MemberIdLine member={member} />
      </View>

      {showBadge && position ? <PlacementBadge side={position} small /> : null}
      {trailing}
      {onPress ? <Icon name="chevron_right" size={22} color={colors.ui.icon} /> : null}
    </Pressable>
  );
}

const cardShadow = `0px 2px 10px ${colors.brand.indigo}0F`;

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: cardShadow,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
    gap: 2,
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
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeSmall: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: colors.neutral.white,
  },
  badgeLabelSmall: {
    fontSize: 10,
    lineHeight: 14,
  },
});
