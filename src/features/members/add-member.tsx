import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isApiError } from "@/api/client";
import type { MemberDetail, NewMember, PlacementPosition } from "@/api/members";
import { Button } from "@/components/button";
import { ErrorState } from "@/components/error-state";
import { Icon } from "@/components/icon";
import { PlacementBadge } from "@/components/member-card";
import { OfflineWriteBlock } from "@/components/offline-block";
import { Skeleton } from "@/components/skeleton";
import { FieldShell, TextField } from "@/components/text-field";
import { useCreateMember, useMember } from "@/hooks/use-members";
import { useIsOnline } from "@/lib/connectivity";
import { formatIsoDate, initialsFor, toIsoDate } from "@/lib/names";
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
import { MemberPicker, type PickerMode } from "./member-picker";
import {
  EARLIEST_JOINING_DATE,
  MEMBER_LIMITS,
  validateJoiningDate,
  validateMiLifestyleId,
  validateName,
  validateNotes,
  validatePhoneNumber,
} from "./validation";

type FieldErrors = {
  name?: string | null;
  miLifestyleId?: string | null;
  phoneNumber?: string | null;
  notes?: string | null;
  joiningDate?: string | null;
  parent?: string | null;
  position?: string | null;
  sponsor?: string | null;
};

/**
 * Register a member and place them under a parent.
 *
 * The form can be opened with `parent` and `position` already chosen (from a tap on an
 * open position in the Team screen), or empty. Whatever it sends, the backend checks
 * the parent, the team and the position again before anything is written.
 */
export default function AddMember() {
  const params = useLocalSearchParams<{ parent?: string; position?: string }>();
  const createMember = useCreateMember();

  const [parentId, setParentId] = useState<string | null>(params.parent ?? null);
  const [position, setPosition] = useState<PlacementPosition | null>(
    params.position === "LEFT" || params.position === "RIGHT" ? params.position : null,
  );
  const [name, setName] = useState("");
  const [miLifestyleId, setMiLifestyleId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [joiningDate, setJoiningDate] = useState<Date | null>(null);
  const [sponsor, setSponsor] = useState<{ id: string; name: string } | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [saved, setSaved] = useState<MemberDetail | null>(null);

  // The chosen parent, including which of its two positions are already filled.
  const parent = useMember(parentId ?? undefined);
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();

  const parentName = parent.data?.name ?? null;
  const takenPositions = {
    LEFT: parent.data?.has_left_child ?? false,
    RIGHT: parent.data?.has_right_child ?? false,
  };

  function clearError(field: keyof FieldErrors) {
    setErrors((current) => ({ ...current, [field]: null }));
  }

  function choosePosition(next: PlacementPosition) {
    setPosition(next);
    clearError("position");
    setFormError(null);
  }

  function chooseParent(member: { id: string; name: string }) {
    setParentId(member.id);
    setPicker(null);
    clearError("parent");
    setFormError(null);
    // A position picked for the previous parent may not be free under this one.
    setPosition(null);
  }

  function validate(): FieldErrors | null {
    const found: FieldErrors = {
      name: validateName(name),
      miLifestyleId: validateMiLifestyleId(miLifestyleId),
      phoneNumber: validatePhoneNumber(phoneNumber),
      notes: validateNotes(notes),
      joiningDate: validateJoiningDate(joiningDate),
      parent: parentId ? null : "Choose the member this person will be placed under.",
      position: position ? null : "Choose the LEFT or RIGHT position.",
    };
    if (position && takenPositions[position]) {
      found.position = "That position is already taken. Choose the other side.";
    }
    return Object.values(found).some(Boolean) ? found : null;
  }

  /** Turn the backend's answer into a message on the field it belongs to. */
  function applyServerError(error: unknown) {
    if (!isApiError(error)) {
      setFormError(error);
      return;
    }
    switch (error.code) {
      case "placement_occupied":
        setErrors((current) => ({
          ...current,
          position: "That position was taken while you were filling this in.",
        }));
        void parent.refetch();
        return;
      case "mi_lifestyle_id_taken":
        setErrors((current) => ({
          ...current,
          miLifestyleId: "That Mi Lifestyle ID is already registered in your team.",
        }));
        return;
      // Both should be out of reach — the form checks the same rule before sending —
      // but if the backend refuses one, put it on the field rather than in a banner.
      case "mi_lifestyle_id_invalid":
      case "mi_lifestyle_id_required":
        setErrors((current) => ({
          ...current,
          miLifestyleId: "Enter the member's 10-digit Mi Lifestyle ID.",
        }));
        return;
      case "parent_not_found":
        setErrors((current) => ({
          ...current,
          parent: "That member is no longer available. Choose another.",
        }));
        return;
      case "sponsor_not_found":
        setErrors((current) => ({
          ...current,
          sponsor: "That sponsor is no longer available. Choose another.",
        }));
        return;
      default:
        setFormError(error);
    }
  }

  function save() {
    if (createMember.isPending) return;
    // The button is already disabled offline; this is the backstop, so a submission
    // cannot slip through on a connection that dropped between render and tap. A
    // mutation sent now would be paused by TanStack Query and sit pending with nothing
    // to show for it, which looks exactly like a save that worked.
    if (!isOnline) return;

    setFormError(null);
    const found = validate();
    setErrors(found ?? {});
    if (found || !parentId || !position) return;

    const member: NewMember = {
      name: name.trim(),
      placement_parent_id: parentId,
      placement_position: position,
      // Required, and validation above has already confirmed it is ten digits.
      mi_lifestyle_id: miLifestyleId.trim(),
    };
    // Optional fields are left out entirely rather than sent empty.
    if (phoneNumber.trim()) member.phone_number = phoneNumber.trim();
    if (notes.trim()) member.notes = notes.trim();
    if (joiningDate) member.joining_date = toIsoDate(joiningDate);
    if (sponsor) member.sponsor_id = sponsor.id;

    createMember.mutate(member, {
      onSuccess: (created) => setSaved(created),
      onError: applyServerError,
    });
  }

  function addAnother() {
    setSaved(null);
    setName("");
    setMiLifestyleId("");
    setPhoneNumber("");
    setNotes("");
    setJoiningDate(null);
    setSponsor(null);
    setPosition(null);
    setErrors({});
    setFormError(null);
    void parent.refetch();
  }

  if (saved) {
    return <MemberSaved member={saved} parentName={parentName} onAddAnother={addAnother} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <ErrorState
            error={formError}
            title="We couldn't save this member"
            onRetry={save}
            isRetrying={createMember.isPending}
          />
        ) : null}

        <FormSection
          icon="badge"
          title="Member details"
          subtitle="Who you are adding to your team"
        >
          <TextField
            label="Full name"
            value={name}
            onChangeText={(value) => {
              setName(value);
              clearError("name");
            }}
            placeholder="e.g. Palanivel"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MEMBER_LIMITS.name}
            error={errors.name}
            returnKeyType="next"
          />
          <TextField
            label="Mi Lifestyle ID"
            value={miLifestyleId}
            onChangeText={(value) => {
              setMiLifestyleId(value);
              clearError("miLifestyleId");
            }}
            placeholder="e.g. 0012345678"
            keyboardType="number-pad"
            autoCorrect={false}
            maxLength={MEMBER_LIMITS.miLifestyleId}
            error={errors.miLifestyleId}
            hint="Exactly 10 digits, as issued. Leading zeros are kept."
          />
          <TextField
            label="Phone number"
            value={phoneNumber}
            onChangeText={(value) => {
              setPhoneNumber(value);
              clearError("phoneNumber");
            }}
            placeholder="e.g. +91 98765 43210"
            keyboardType="phone-pad"
            maxLength={MEMBER_LIMITS.phoneNumber}
            error={errors.phoneNumber}
            optional
          />
        </FormSection>

        <FormSection
          icon="account_tree"
          title="Placement"
          subtitle="Where this member sits in your binary structure"
        >
          <FieldShell label="Placement parent" error={errors.parent}>
            <SelectRow
              icon="person_search"
              placeholder="Choose a member"
              value={parentName}
              loading={parentId !== null && parent.isPending}
              failed={parentId !== null && parent.isError}
              onPress={() => setPicker("parent")}
            />
          </FieldShell>

          <FieldShell
            label="Position"
            error={errors.position}
            hint={
              parentId && parent.isSuccess
                ? `Under ${parentName}. A filled position can't be reused.`
                : "Choose a placement parent first."
            }
          >
            <View style={styles.positionRow}>
              {(["LEFT", "RIGHT"] as const).map((side) => (
                <PositionChoice
                  key={side}
                  side={side}
                  selected={position === side}
                  taken={takenPositions[side]}
                  disabled={!parentId || !parent.isSuccess}
                  onPress={() => choosePosition(side)}
                />
              ))}
            </View>
          </FieldShell>
        </FormSection>

        <FormSection
          icon="more_horiz"
          title="Extra details"
          subtitle="Useful later, and all optional"
        >
          <FieldShell
            label="Sponsored by"
            optional
            error={errors.sponsor}
            hint="Who introduced this member. Independent of the placement above."
          >
            <SelectRow
              icon="handshake"
              placeholder="Not recorded"
              value={sponsor?.name ?? null}
              onPress={() => setPicker("sponsor")}
              onClear={sponsor ? () => setSponsor(null) : undefined}
            />
          </FieldShell>

          <FieldShell label="Joining date" optional error={errors.joiningDate}>
            <SelectRow
              icon="event"
              placeholder="Not recorded"
              value={joiningDate ? formatIsoDate(toIsoDate(joiningDate)) : null}
              onPress={() => setDatePickerOpen(true)}
              onClear={
                joiningDate
                  ? () => {
                      setJoiningDate(null);
                      clearError("joiningDate");
                    }
                  : undefined
              }
            />
          </FieldShell>

          <TextField
            label="Notes"
            value={notes}
            onChangeText={(value) => {
              setNotes(value);
              clearError("notes");
            }}
            placeholder="Anything worth remembering about this member"
            multiline
            maxLength={MEMBER_LIMITS.notes}
            error={errors.notes}
            optional
          />
        </FormSection>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {/* Registering a member is a structural change to the team, and V1 never queues
            one: see `OfflineWriteBlock`. */}
        {isOnline ? null : <OfflineWriteBlock action="Registering a member" />}
        <Button
          label="Save Member"
          icon="check"
          loading={createMember.isPending}
          disabled={!isOnline}
          onPress={save}
          accessibilityHint={
            isOnline
              ? "Adds this member to your team"
              : "Unavailable without a connection"
          }
        />
      </View>

      <MemberPicker
        visible={picker !== null}
        mode={picker ?? "parent"}
        selectedId={picker === "parent" ? parentId : sponsor?.id}
        onClose={() => setPicker(null)}
        onSelect={(member) => {
          if (picker === "parent") {
            chooseParent(member);
          } else {
            setSponsor({ id: member.id, name: member.name });
            setPicker(null);
            clearError("sponsor");
          }
        }}
      />

      {datePickerOpen ? (
        <DateTimePicker
          value={joiningDate ?? new Date()}
          mode="date"
          presentation="dialog"
          minimumDate={EARLIEST_JOINING_DATE}
          maximumDate={new Date()}
          accentColor={colors.interaction.primary}
          onValueChange={(_event, date) => {
            setJoiningDate(date);
            clearError("joiningDate");
            setDatePickerOpen(false);
          }}
          onDismiss={() => setDatePickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function FormSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Icon name={icon} size={20} color={colors.interaction.primary} />
        </View>
        <View style={styles.sectionHeaderText}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.sectionTitle}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionSubtitle}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/** A field that opens a picker: shows what is chosen, or a placeholder. */
function SelectRow({
  icon,
  placeholder,
  value,
  onPress,
  onClear,
  loading = false,
  failed = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  placeholder: string;
  value: string | null;
  onPress: () => void;
  onClear?: () => void;
  loading?: boolean;
  failed?: boolean;
}) {
  return (
    <View style={styles.selectRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ?? placeholder}
        onPress={onPress}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
      >
        <Icon name={icon} size={20} color={colors.ui.icon} />
        {loading ? (
          <View style={styles.selectValue}>
            <Skeleton width="60%" height={14} />
          </View>
        ) : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={[
              styles.selectValue,
              value ? styles.selectValueChosen : styles.selectPlaceholder,
              failed && styles.selectValueFailed,
            ]}
          >
            {failed ? "Couldn't load this member" : (value ?? placeholder)}
          </Text>
        )}
        <Icon name="expand_more" size={22} color={colors.ui.icon} />
      </Pressable>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear"
          onPress={onClear}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Icon name="close" size={18} color={colors.ui.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One of the two placement slots, with its availability shown up front. */
function PositionChoice({
  side,
  selected,
  taken,
  disabled,
  onPress,
}: {
  side: PlacementPosition;
  selected: boolean;
  taken: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { accent, tint, label } = placementStyle[side];
  const blocked = disabled || taken;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: blocked }}
      accessibilityLabel={`${label} position${taken ? ", already taken" : ""}`}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.position,
        {
          borderColor: selected ? accent : colors.ui.border,
          backgroundColor: selected ? tint : colors.ui.surface,
        },
        blocked && styles.positionBlocked,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.positionTop}>
        <PlacementBadge side={side} />
        {selected ? <Icon name="check_circle" size={20} color={accent} /> : null}
      </View>
      <Text maxFontSizeMultiplier={1.2} style={styles.positionState}>
        {taken ? "Already taken" : disabled ? "Choose a parent" : "Open"}
      </Text>
    </Pressable>
  );
}

function MemberSaved({
  member,
  parentName,
  onAddAnother,
}: {
  member: MemberDetail;
  parentName: string | null;
  onAddAnother: () => void;
}) {
  const side = member.placement_position;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.successCard}>
          <View style={styles.successIcon}>
            <Icon name="check_circle" size={34} color={colors.semantic.success} />
          </View>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.successTitle}>
            {member.name} was added
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.successMessage}>
            {side && parentName
              ? `Placed in the ${side} position under ${parentName}.`
              : "Saved to your team."}
          </Text>

          <View style={styles.successMember}>
            <View style={styles.successAvatar}>
              <Text allowFontScaling={false} style={styles.successInitials}>
                {initialsFor(member.name)}
              </Text>
            </View>
            <View style={styles.successMemberText}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.successName}>
                {member.name}
              </Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.successMeta}>
                {member.mi_lifestyle_id ? `ID ${member.mi_lifestyle_id}` : "No Mi Lifestyle ID"}
              </Text>
            </View>
            {side ? <PlacementBadge side={side} small /> : null}
          </View>
        </View>

        <View style={styles.successActions}>
          <Button label="Add another member" icon="person_add" onPress={onAddAnother} />
          <Button
            label="View member"
            icon="person"
            variant="secondary"
            onPress={() =>
              router.replace({ pathname: "/members/[id]", params: { id: member.id } })
            }
          />
          <Button label="Back to team" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ui.screen,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  pressed: {
    opacity: 0.82,
  },
  section: {
    gap: spacing.base,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 2px 12px ${colors.brand.indigo}0D`,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  sectionHeaderText: {
    flex: 1,
    gap: 1,
  },
  sectionTitle: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  sectionSubtitle: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  sectionBody: {
    gap: spacing.base,
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  select: {
    flex: 1,
    height: componentTokens.input.height,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.md,
    borderColor: componentTokens.input.border,
    backgroundColor: componentTokens.input.background,
  },
  selectValue: {
    ...componentTokens.input.typography,
    flex: 1,
  },
  selectValueChosen: {
    fontFamily: fontFamily.medium,
    color: colors.ui.textPrimary,
  },
  selectValueFailed: {
    color: colors.semantic.error,
  },
  selectPlaceholder: {
    color: componentTokens.input.placeholder,
  },
  clear: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.neutral.gray100,
  },
  positionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  position: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.lg,
  },
  positionBlocked: {
    opacity: 0.5,
  },
  positionTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  positionState: {
    ...typography.bodySmall,
    fontFamily: fontFamily.medium,
    color: colors.ui.textSecondary,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.ui.border,
    backgroundColor: colors.ui.surface,
  },
  successCard: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: `${colors.semantic.success}33`,
    backgroundColor: statusColors.success.background,
  },
  successIcon: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.neutral.white,
  },
  successTitle: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  successMessage: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
  successMember: {
    alignSelf: "stretch",
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.neutral.white,
  },
  successAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: statusColors.success.background,
  },
  successInitials: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.semantic.success,
  },
  successMemberText: {
    flex: 1,
    gap: 2,
  },
  successName: {
    ...typography.h4,
    fontFamily: fontFamily.semiBold,
    color: colors.ui.textPrimary,
  },
  successMeta: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  successActions: {
    gap: spacing.md,
  },
});
