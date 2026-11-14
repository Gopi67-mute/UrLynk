import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { isApiError } from "@/api/client";
import type { MemberDeletionPlan, MemberSummary } from "@/api/members";
import { Button } from "@/components/button";
import { ErrorState } from "@/components/error-state";
import { Icon, type IconName } from "@/components/icon";
import { MemberCard, PlacementBadge } from "@/components/member-card";
import { OfflineWriteBlock } from "@/components/offline-block";
import { Skeleton } from "@/components/skeleton";
import {
  confirmationExplanation,
  confirmPromotionId,
  deletionFailureMessage,
  deletionStep,
  isSettledRefusal,
  isStale,
  memberIdFrom,
  memberNameFrom,
  pathLabel,
  reattachmentSentence,
  refusalTitle,
} from "@/features/members/deletion-plan";
import { useConfirmMemberDeletion, useMemberDeletionPlan } from "@/hooks/use-members";
import { useIsOnline } from "@/lib/connectivity";
import { openEditProfile } from "@/lib/navigation";
import {
  colors,
  componentTokens,
  fontFamily,
  placementStyle,
  radius,
  spacing,
  statusColors,
  typography,
  type PlacementSide,
} from "@/theme";

/**
 * Removing a member who has people placed below them.
 *
 * The screen never works out where anybody goes. It asks the backend what deleting this
 * member would do, shows that plan in plain words, and sends it back to be carried out
 * — so what the leader confirms is exactly what the server calculated, against the team
 * as it actually is.
 *
 * Two steps at most:
 *
 * 1. with two members directly below, choose which of them takes the deleted member's
 *    position (a member with only one below them skips this — there is nothing to ask);
 * 2. read what will happen, and confirm.
 *
 * Nothing is written until that confirmation. Leaving at any point, by the Cancel
 * button or the back gesture, changes nothing at all.
 */
export default function MemberDeleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The choice and any failure belong to the member they were made about, and are
  // stored with them. A screen reused for a different member — the router may keep this
  // instance rather than mounting a new one — would otherwise carry the last member's
  // promotion into a request about this one, which the backend rightly refuses as a
  // member who is not their child.
  const [state, setState] = useState<{
    forMember: string | undefined;
    promote: string | null;
    failure: string | null;
  }>({ forMember: id, promote: null, failure: null });

  const belongsHere = state.forMember === id;
  const promote = belongsHere ? state.promote : null;
  const failure = belongsHere ? state.failure : null;

  const plan = useMemberDeletionPlan(id, promote);
  const confirm = useConfirmMemberDeletion(id);
  const isOnline = useIsOnline();

  const setFailure = useCallback(
    (message: string | null) =>
      setState((current) => ({
        forMember: id,
        promote: current.forMember === id ? current.promote : null,
        failure: message,
      })),
    [id],
  );

  const refresh = useCallback(() => {
    setFailure(null);
    void plan.refetch();
  }, [plan, setFailure]);

  function choose(memberId: string | null) {
    setState({ forMember: id, promote: memberId, failure: null });
  }

  function back() {
    if (router.canGoBack()) router.back();
  }

  function run(reviewed: MemberDeletionPlan) {
    if (confirm.isPending) return;
    // The backstop behind the disabled confirm button: a reorganizing deletion must
    // never be handed to a paused mutation, where it would look like it was running.
    if (!isOnline) return;
    setFailure(null);

    confirm.mutate(
      // Both taken from the plan the leader just read, never from local state: what is
      // confirmed is exactly what was previewed.
      { planToken: reviewed.plan_token, promoteMemberId: confirmPromotionId(reviewed) },
      {
        // The member no longer exists, so neither does the screen that describes them.
        // Going back twice leaves their detail screen behind as well.
        onSuccess: () => {
          if (router.canGoBack()) router.back();
          if (router.canGoBack()) router.back();
        },
        onError: (error) => {
          if (!isApiError(error)) {
            setFailure("We couldn't delete this member. Please try again.");
            return;
          }
          setFailure(deletionFailureMessage(error.code, error.userMessage, error.details));
          // The plan the leader confirmed is no longer the plan: fetch the new one so
          // they review what would actually happen before confirming again.
          if (isStale(error.code)) void plan.refetch();
        },
      },
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Delete Member" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {plan.isPending ? (
          <LoadingPlan />
        ) : plan.isError ? (
          <PlanUnavailable error={plan.error} onRetry={refresh} isRetrying={plan.isFetching} />
        ) : (
          <LoadedPlan
            plan={plan.data}
            onChoose={choose}
            onConfirm={run}
            onCancel={back}
            isWorking={confirm.isPending}
            isRefreshing={plan.isFetching}
            failure={failure}
          />
        )}
      </ScrollView>
    </View>
  );
}

function LoadedPlan({
  plan,
  onChoose,
  onConfirm,
  onCancel,
  isWorking,
  isRefreshing,
  failure,
}: {
  plan: MemberDeletionPlan;
  onChoose: (memberId: string | null) => void;
  onConfirm: (plan: MemberDeletionPlan) => void;
  onCancel: () => void;
  isWorking: boolean;
  isRefreshing: boolean;
  failure: string | null;
}) {
  const step = deletionStep(plan);

  return (
    <>
      <TargetCard plan={plan} />

      {step === "choose" ? (
        <ChooseWhoTakesThePosition plan={plan} onChoose={onChoose} />
      ) : (
        <ReviewAndConfirm
          plan={plan}
          // Offered only when there were two candidates: with one, there is nothing to
          // change the choice to.
          onChangeChoice={plan.promotable.length === 2 ? () => onChoose(null) : undefined}
          onConfirm={onConfirm}
          onCancel={onCancel}
          isWorking={isWorking}
        />
      )}

      {failure ? (
        <View style={styles.failure}>
          <Icon name="error" size={18} color={colors.semantic.error} />
          <Text accessibilityLiveRegion="polite" style={styles.failureText}>
            {failure}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/** Who is being deleted, and where they sit today. */
function TargetCard({ plan }: { plan: MemberDeletionPlan }) {
  const side = plan.placement_position;

  return (
    <View style={styles.targetCard}>
      <View style={styles.targetHeader}>
        <Icon name="delete" size={20} color={colors.semantic.error} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={styles.targetName}>
          {plan.member.name}
        </Text>
        {side ? <PlacementBadge side={side} small /> : null}
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.targetMeta}>
        {plan.placement_parent
          ? `Currently in the ${side} position under ${plan.placement_parent.name}.`
          : "Currently placed in your team."}
      </Text>
    </View>
  );
}

/** Step one: the leader picks which of the two members below takes the position. */
function ChooseWhoTakesThePosition({
  plan,
  onChoose,
}: {
  plan: MemberDeletionPlan;
  onChoose: (memberId: string) => void;
}) {
  return (
    <Card icon="account_tree" title="Reorganize Before Deleting">
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        This member has two members placed directly below them. Choose who should take
        their position.
      </Text>

      {plan.promotable.map((candidate) => (
        <PromotionOption key={candidate.id} member={candidate} onPress={() => onChoose(candidate.id)} />
      ))}

      <Text maxFontSizeMultiplier={1.3} style={styles.note}>
        The other member&apos;s entire team will be reattached automatically, and keeps
        its own structure.
      </Text>
    </Card>
  );
}

/** One of the two members who could take the deleted member's position. */
function PromotionOption({
  member,
  onPress,
}: {
  member: MemberSummary;
  onPress: () => void;
}) {
  const side = member.placement_position as PlacementSide | null;
  const accent = side ? placementStyle[side].accent : colors.interaction.primary;

  return (
    <View style={styles.option}>
      {/* The card draws its own chevron when it is tappable, so the side they occupy
          today is the useful thing to add here. */}
      <MemberCard member={member} side={side ?? undefined} onPress={onPress} showBadge />
      <Button
        label={side ? `Promote ${member.name} — ${side}` : `Promote ${member.name}`}
        variant="secondary"
        tone={accent}
        onPress={onPress}
        accessibilityHint="Shows what happens if this member takes the position"
      />
    </View>
  );
}

/** Step two: what will happen, in full, and the one action that makes it happen. */
function ReviewAndConfirm({
  plan,
  onChangeChoice,
  onConfirm,
  onCancel,
  isWorking,
}: {
  plan: MemberDeletionPlan;
  onChangeChoice?: () => void;
  onConfirm: (plan: MemberDeletionPlan) => void;
  onCancel: () => void;
  isWorking: boolean;
}) {
  const isOnline = useIsOnline();
  const promoted = plan.promoted;
  const reattachment = plan.reattachment;
  const destination = reattachmentSentence(plan);

  return (
    <>
      {promoted ? (
        <Card icon="arrow_upward" title="Takes their position">
          <MemberCard member={promoted} showBadge />
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {promoted.name} moves up into {plan.member.name}&apos;s position. The members
            already below {promoted.name} stay exactly where they are.
          </Text>
          {onChangeChoice ? (
            <Button
              label="Choose someone else"
              icon="swap_horiz"
              variant="ghost"
              compact
              onPress={onChangeChoice}
            />
          ) : null}
        </Card>
      ) : null}

      {reattachment && destination ? (
        <Card icon="move_down" title="Moves with their team">
          <MemberCard member={reattachment.member} showBadge />
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {destination}
          </Text>
          <View style={styles.pathBox}>
            <Text allowFontScaling={false} style={styles.pathLabel}>
              NEW POSITION
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.pathValue}>
              {pathLabel(reattachment.destination_path)}
            </Text>
            <View
              style={[
                styles.pathSide,
                { backgroundColor: placementStyle[reattachment.destination_position].tint },
              ]}
            >
              <PlacementBadge side={reattachment.destination_position} small />
              <Text maxFontSizeMultiplier={1.2} style={styles.pathSideText}>
                under {reattachment.destination.name}
              </Text>
            </View>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.note}>
            {reattachment.member_count > 1
              ? `All ${reattachment.member_count} members in this team move together and keep their own positions.`
              : "This member keeps all of their own details."}
          </Text>
        </Card>
      ) : null}

      <View style={styles.confirmCard}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={styles.confirmTitle}>
          Are you sure you want to permanently delete {plan.member.name}?
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.confirmBody}>
          {confirmationExplanation(plan)}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.confirmWarning}>
          This cannot be undone.
        </Text>

        <View style={styles.actions}>
          {/* A reorganizing deletion moves a whole subtree, and the server recalculates
              the plan inside the transaction that applies it. There is nothing sensible
              to do with one of these offline except refuse it. */}
          {isOnline ? null : <OfflineWriteBlock action="Deleting a member" />}
          <Button
            label="Confirm & Delete"
            icon="delete"
            tone={colors.semantic.error}
            loading={isWorking}
            disabled={!isOnline}
            onPress={() => onConfirm(plan)}
            accessibilityHint={
              isOnline
                ? `Permanently deletes ${plan.member.name} and reorganizes your team`
                : "Unavailable without a connection"
            }
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={isWorking}
            onPress={onCancel}
            accessibilityHint="Leaves your team unchanged"
          />
        </View>

        <Text maxFontSizeMultiplier={1.3} style={styles.note}>
          Nothing is changed until you confirm.
        </Text>
      </View>
    </>
  );
}

/**
 * A plan that could not be fetched.
 *
 * Some of these are not failures to retry but answers: the leader's own record cannot
 * be deleted, a member another record names as sponsor cannot be either, and a member
 * who has no Mi Lifestyle ID yet cannot be moved until they have one. Those read as
 * what they are, with no retry offered, because retrying cannot change them — and where
 * there is something the leader can actually do about it, the screen offers it.
 *
 * Getting this wrong is what made the original failure so hard to act on: a refusal the
 * leader could fix in thirty seconds was shown as "this changed in the meantime,
 * refresh and try again", which is both untrue and a loop with no way out.
 */
function PlanUnavailable({
  error,
  onRetry,
  isRetrying,
}: {
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  if (isApiError(error) && isSettledRefusal(error.code)) {
    // Present only when the backend named the member standing in the way — which is the
    // case this exists for, because that member is not the one being deleted.
    const blockingId = memberIdFrom(error.details);
    const blockingName = memberNameFrom(error.details);

    return (
      <View style={styles.blocked}>
        <Icon name="block" size={28} color={colors.semantic.warning} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={styles.blockedTitle}>
          {refusalTitle(error.code)}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.blockedBody}>
          {deletionFailureMessage(error.code, error.userMessage, error.details)}
        </Text>
        {blockingId ? (
          <Button
            label={blockingName ? `Edit ${blockingName}` : "Edit member"}
            icon="edit"
            onPress={() => openEditProfile(blockingId)}
            accessibilityHint="Opens their profile so you can add the missing details"
          />
        ) : null}
        <Button
          label="Go Back"
          variant="secondary"
          onPress={() => router.canGoBack() && router.back()}
        />
      </View>
    );
  }

  return (
    <ErrorState
      error={error}
      title="We couldn't check what this would do"
      onRetry={onRetry}
      isRetrying={isRetrying}
    />
  );
}

function LoadingPlan() {
  return (
    <View style={styles.loading}>
      <Skeleton height={96} corner={radius.xl} />
      <Skeleton height={220} corner={radius.xl} />
      <Skeleton height={160} corner={radius.xl} />
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
  targetCard: {
    gap: spacing.sm,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.semantic.error}40`,
    backgroundColor: statusColors.error.background,
  },
  targetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  targetName: {
    ...typography.h4,
    flexShrink: 1,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  targetMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
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
    flexShrink: 1,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  cardBody: {
    gap: spacing.md,
  },
  body: {
    ...typography.bodyMedium,
    color: colors.ui.textPrimary,
  },
  note: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  option: {
    gap: spacing.sm,
  },
  pathBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: componentTokens.card.border,
    backgroundColor: colors.ui.screen,
  },
  pathLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color: colors.ui.textSecondary,
  },
  pathValue: {
    ...typography.bodyMedium,
    fontFamily: fontFamily.medium,
    color: colors.ui.textPrimary,
  },
  pathSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  pathSideText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textPrimary,
  },
  confirmCard: {
    gap: spacing.md,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.brand.purple}33`,
    backgroundColor: componentTokens.card.background,
  },
  confirmTitle: {
    ...typography.h4,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  confirmBody: {
    ...typography.bodyMedium,
    color: colors.ui.textPrimary,
  },
  confirmWarning: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: statusColors.error.text,
  },
  actions: {
    gap: spacing.sm,
  },
  failure: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: statusColors.error.background,
  },
  failureText: {
    ...typography.bodySmall,
    flex: 1,
    color: statusColors.error.text,
  },
  blocked: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
  },
  blockedTitle: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    textAlign: "center",
    color: colors.ui.textPrimary,
  },
  blockedBody: {
    ...typography.bodyMedium,
    textAlign: "center",
    color: colors.ui.textSecondary,
  },
});
