import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MemberSearchResult } from "@/api/members";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Icon } from "@/components/icon";
import { PlacementBadge } from "@/components/member-card";
import { SkeletonCard } from "@/components/skeleton";
import { SCREEN_GUTTER } from "@/components/tab-screen";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMemberSearch } from "@/hooks/use-members";
import { useIsOnline } from "@/lib/connectivity";
import { initialsFor } from "@/lib/names";
import { openMember } from "@/lib/navigation";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
  typography,
} from "@/theme";
import {
  normalizeQuery,
  placementText,
  resultCountText,
  SEARCH_DEBOUNCE_MS,
  searchState,
} from "./search-query";

/**
 * Find a member anywhere in the team, without walking the tree to get there.
 *
 * The search runs in PostgreSQL, scoped by the backend to the signed-in leader's own
 * team: the directory is never downloaded and filtered here, and no query can reach
 * another leader's members.
 *
 * Typing does not send a request. The field settles for a moment first
 * (`SEARCH_DEBOUNCE_MS`), so a ten-digit Mi Lifestyle ID costs one request rather than
 * ten, and the settled query is what keys the cache — which is what makes a slow earlier
 * response unable to appear as the answer to a later one.
 *
 * A `FlatList` renders the rows, so a page of results costs what is on screen. Faces are
 * drawn from initials rather than fetched: a photo is one request per member, and a list
 * is the one place in the app where that would mean a screenful of them at once. The
 * member's own screen, one tap away, shows their photograph.
 */
export default function Search() {
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState("");
  const settled = useDebouncedValue(normalizeQuery(typed), SEARCH_DEBOUNCE_MS);
  const results = useMemberSearch(settled);
  const isOnline = useIsOnline();

  const items = results.data?.items ?? [];
  const state = searchState({
    typed,
    submitted: settled,
    isPending: results.isPending,
    isError: results.isError,
    resultCount: results.data ? items.length : null,
    isOnline,
  });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.base }]}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          Find Member
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
          Search your whole team by name or Mi Lifestyle ID
        </Text>

        <View style={styles.field}>
          <Icon name="search" size={22} color={colors.ui.icon} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search by member name or Mi Lifestyle ID"
            placeholderTextColor={componentTokens.input.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxFontSizeMultiplier={1.3}
            accessibilityLabel="Search by member name or Mi Lifestyle ID"
            style={styles.input}
          />
          {typed.length > 0 ? (
            <TouchableOpacity
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setTyped("")}
              hitSlop={spacing.sm}
            >
              <Icon name="cancel" size={20} color={colors.ui.icon} />
            </TouchableOpacity>
          ) : null}
        </View>

        {state === "results" ? (
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.3}
            style={styles.resultCount}
          >
            {resultCountText(items.length, Boolean(results.data?.next_cursor))}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={state === "results" ? items : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ResultRow member={item} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <SearchBody
            state={state}
            query={settled}
            error={results.error}
            isRetrying={results.isFetching}
            onRetry={() => void results.refetch()}
          />
        }
      />
    </View>
  );
}

/** Whatever is shown when there are no rows: the opening state, a skeleton, or why not. */
function SearchBody({
  state,
  query,
  error,
  isRetrying,
  onRetry,
}: {
  state: ReturnType<typeof searchState>;
  query: string;
  error: unknown;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  if (state === "searching") {
    return (
      <View style={styles.loading}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </View>
    );
  }

  if (state === "error") {
    return (
      <ErrorState
        error={error}
        title="We couldn't search your team"
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }

  if (state === "offline") {
    // The one screen in the app that genuinely cannot work offline: the matching runs
    // in PostgreSQL over the whole team, and the alternative — downloading the directory
    // to filter it here — is exactly what this feature was built not to do.
    return (
      <EmptyState
        icon="wifi_off"
        title="Search needs a connection"
        message="Your team is searched on the server, so this is the one thing UrLynk can't do offline. Your dashboard and team structure are still readable."
      />
    );
  }

  if (state === "no-results") {
    return (
      <EmptyState
        icon="person_search"
        title="No members found"
        message={`Nobody in your team matches "${query}". Check the spelling, or try part of a name or the first digits of a Mi Lifestyle ID.`}
      />
    );
  }

  return (
    <EmptyState
      icon="person_search"
      title="Search your team"
      message="Type a member's name, or the first digits of their Mi Lifestyle ID. Results come from your own team only, however deep a member sits."
    />
  );
}

/**
 * One match.
 *
 * Says where the member sits as well as who they are, because two members can share a
 * name and "LEFT under Ajay" is what tells them apart. Tapping opens their existing
 * member screen, which is the same destination every other list in the app uses.
 */
function ResultRow({ member }: { member: MemberSearchResult }) {
  const side = member.placement_position;
  const placement = placementText(side, member.placement_parent_name);
  const identifier = member.mi_lifestyle_id
    ? `ID ${member.mi_lifestyle_id}`
    : "No Mi Lifestyle ID";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${member.name}. ${identifier}. ${
        member.is_root ? "You, team leader" : (placement ?? "No placement recorded")
      }`}
      accessibilityHint="Opens this member's details"
      onPress={() => openMember(member.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* Initials rather than a photograph: see the note on the screen above. */}
      <Avatar
        size={44}
        initials={initialsFor(member.name)}
        imageUri={null}
        ringColor={colors.interaction.primaryLight}
      />

      <View style={styles.rowBody}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rowName}>
          {member.name}
        </Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rowMeta}>
          {identifier}
        </Text>
        {member.is_root ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rowLeader}>
            You • Team Leader
          </Text>
        ) : placement ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.rowMeta}>
            {placement}
          </Text>
        ) : null}
      </View>

      {side ? <PlacementBadge side={side} small /> : null}
      <Icon name="chevron_right" size={22} color={colors.ui.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ui.screen,
    backgroundImage: `radial-gradient(circle at 100% 0%, ${colors.interaction.primaryLight} 0%, ${colors.ui.screen} 45%)`,
  },
  header: {
    gap: spacing.xs,
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    fontFamily: typography.h1.fontFamily,
    color: colors.ui.textPrimary,
  },
  subtitle: {
    ...typography.bodyMedium,
    marginBottom: spacing.md,
    color: colors.ui.textSecondary,
  },
  field: {
    height: componentTokens.input.height,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.pill,
    borderColor: colors.ui.inputBorder,
    backgroundColor: colors.ui.inputBackground,
  },
  input: {
    ...componentTokens.input.typography,
    flex: 1,
    height: "100%",
    paddingVertical: 0,
    color: colors.ui.textPrimary,
    includeFontPadding: false,
  },
  resultCount: {
    ...typography.bodySmall,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    fontFamily: fontFamily.medium,
    color: colors.ui.textSecondary,
  },
  list: {
    flexGrow: 1,
    gap: spacing.md,
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: spacing.xxl,
  },
  loading: {
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
  rowBody: {
    flex: 1,
    gap: 1,
  },
  rowName: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  rowMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  rowLeader: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.interaction.primary,
  },
});
