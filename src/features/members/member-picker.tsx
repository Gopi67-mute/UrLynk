import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MemberListItem } from "@/api/members";
import { ErrorState } from "@/components/error-state";
import { Icon } from "@/components/icon";
import { MemberCard } from "@/components/member-card";
import { SkeletonCard } from "@/components/skeleton";
import { useMemberDirectory } from "@/hooks/use-members";
import { colors, fontFamily, radius, spacing, typography } from "@/theme";

export type PickerMode = "parent" | "sponsor";

/** Why a member cannot be picked, or null when they can. */
function unavailableReason(member: MemberListItem, mode: PickerMode): string | null {
  if (mode !== "parent") return null;
  if (member.has_left_child && member.has_right_child) return "Both positions taken";
  return null;
}

function availabilityNote(member: MemberListItem, mode: PickerMode): string | null {
  if (mode !== "parent") return null;
  if (member.has_left_child && member.has_right_child) return null;
  if (member.has_left_child) return "RIGHT open";
  if (member.has_right_child) return "LEFT open";
  return "Both open";
}

/**
 * Choose a member from the team.
 *
 * The list is paged from the API, so a team of a thousand opens as fast as a team of
 * three. In `parent` mode a member whose two positions are both filled is shown but
 * cannot be chosen, which keeps the form from offering a placement that must fail.
 */
export function MemberPicker({
  visible,
  mode,
  onClose,
  onSelect,
  selectedId,
}: {
  visible: boolean;
  mode: PickerMode;
  onClose: () => void;
  onSelect: (member: MemberListItem) => void;
  selectedId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const directory = useMemberDirectory();

  const title = mode === "parent" ? "Choose placement parent" : "Choose sponsor";
  const subtitle =
    mode === "parent"
      ? "The member this person will be placed under"
      : "The member who introduced this person";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={false}
    >
      <View style={[styles.sheet, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
              {title}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={spacing.sm}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Icon name="close" size={22} color={colors.ui.textSecondary} />
          </Pressable>
        </View>

        {directory.isPending ? (
          <View style={styles.loading}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : directory.isError ? (
          <View style={styles.loading}>
            <ErrorState
              error={directory.error}
              title="We couldn't load your team"
              onRetry={() => void directory.refetch()}
              isRetrying={directory.isFetching}
            />
          </View>
        ) : (
          <FlatList
            data={directory.members}
            keyExtractor={(member) => member.id}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (directory.hasNextPage && !directory.isFetchingNextPage) {
                void directory.fetchNextPage();
              }
            }}
            ListFooterComponent={
              directory.isFetchingNextPage ? (
                <ActivityIndicator style={styles.footer} color={colors.interaction.primary} />
              ) : undefined
            }
            renderItem={({ item }) => {
              const reason = unavailableReason(item, mode);
              const note = availabilityNote(item, mode);
              const selected = item.id === selectedId;

              return (
                <View style={reason ? styles.unavailable : undefined}>
                  <MemberCard
                    member={item}
                    showBadge
                    onPress={reason ? undefined : () => onSelect(item)}
                    trailing={
                      <View style={styles.trailing}>
                        {selected ? (
                          <Icon
                            name="check_circle"
                            size={22}
                            color={colors.interaction.primary}
                          />
                        ) : null}
                        {reason ?? note ? (
                          <Text
                            allowFontScaling={false}
                            style={[styles.note, reason && styles.noteBlocked]}
                          >
                            {reason ?? note}
                          </Text>
                        ) : null}
                      </View>
                    }
                  />
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.ui.screen,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.border,
    backgroundColor: colors.ui.surface,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  close: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.neutral.gray100,
  },
  pressed: {
    opacity: 0.7,
  },
  loading: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  list: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  footer: {
    paddingVertical: spacing.base,
  },
  unavailable: {
    opacity: 0.55,
  },
  trailing: {
    alignItems: "flex-end",
    gap: 2,
  },
  note: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.ui.textSecondary,
  },
  noteBlocked: {
    color: colors.semantic.error,
  },
});
