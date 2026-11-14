import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router, Stack, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import type { MemberDetail } from "@/api/members";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Icon, type IconName } from "@/components/icon";
import { OfflineWriteBlock } from "@/components/offline-block";
import { Skeleton } from "@/components/skeleton";
import { FieldShell, TextField } from "@/components/text-field";
import { useMember, useMemberPhoto, useSaveMemberPhoto, useUpdateMember } from "@/hooks/use-members";
import { useIsOnline } from "@/lib/connectivity";
import { formatIsoDate, initialsFor, toIsoDate } from "@/lib/names";
import { pickProfilePhoto } from "@/lib/profile-photo";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";
import { MemberPicker } from "./member-picker";
import {
  changedFields,
  formFromMember,
  hasUnsavedChanges,
  type ProfileForm,
} from "./profile-changes";
import {
  EARLIEST_JOINING_DATE,
  MEMBER_LIMITS,
  validateJoiningDate,
  validateMiLifestyleId,
  validateName,
  validateNotes,
  validatePhoneNumber,
} from "./validation";

type FieldErrors = Partial<Record<keyof ProfileForm, string | null>>;

/** A photo chosen but not yet saved, shown as a preview. */
type PendingPhoto = { previewUri: string; data: string; contentType: string };

/**
 * Edit a member's profile — including the leader's own.
 *
 * The leader is the root member of their team, so there is one screen and one update
 * path for both. What differs is only what is relevant: the leader's record carries
 * the profile photo the whole app shows, and has no sponsor to record.
 *
 * Two rules shape this screen:
 *
 * - Only what changed is sent. A field nobody touched is left out of the request, so
 *   it keeps what is stored rather than being rewritten with what the form loaded.
 * - Nothing structural is editable. Placement, team, root status and the Clerk
 *   identity are not here and the backend refuses them, so saving a profile can never
 *   move a member or reach another team.
 */
export default function MemberEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const member = useMember(id);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{ title: member.data?.is_root ? "Edit Profile" : "Edit Member" }}
      />
      {!id ? (
        // `id` is a search parameter, so this screen can be reached without one — by a
        // deep link, say. Without it there is no member to load and the query stays
        // disabled, so say so rather than spinning on a request that will never run.
        <View style={styles.content}>
          <EmptyState
            icon="person_off"
            title="No profile to edit"
            message="Open a member from your team, or Settings, to edit their profile."
          />
        </View>
      ) : member.isError ? (
        <View style={styles.content}>
          <ErrorState
            error={member.error}
            title="We couldn't open this profile"
            onRetry={() => void member.refetch()}
            isRetrying={member.isFetching}
          />
        </View>
      ) : member.isPending ? (
        <LoadingForm />
      ) : (
        // Keyed on the record, so a background refresh never reshuffles a form being
        // filled in: the form is initialised once, from the version that was loaded.
        <EditForm key={member.data.id} member={member.data} />
      )}
    </View>
  );
}

function EditForm({ member }: { member: MemberDetail }) {
  const [form, setForm] = useState<ProfileForm>(() => formFromMember(member));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sponsorPickerOpen, setSponsorPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  // Set once the user has confirmed they are happy to lose their edits.
  const [discarding, setDiscarding] = useState(false);
  // The chosen sponsor's name, so the field can show it before the save round trip.
  const [sponsorName, setSponsorName] = useState<string | null>(member.sponsor?.name ?? null);

  const update = useUpdateMember(member.id);
  const savePhoto = useSaveMemberPhoto(member.id);
  const storedPhoto = useMemberPhoto(member.id, member.photo_updated_at);
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();

  const isLeader = member.is_root;
  const isSaving = update.isPending || savePhoto.isPending;
  const photoChanged = pendingPhoto !== null || photoRemoved;
  const dirty = !saved && (photoChanged || hasUnsavedChanges(form, member));

  // Leaving with unsaved work asks first. `usePreventRemove` covers the header's back
  // button, the Android system back gesture and the Cancel action alike, so there is
  // one confirmation however the user tries to leave.
  usePreventRemove(
    dirty && !isSaving && !discarding,
    useCallback(({ repeat }) => {
      Alert.alert("Discard changes?", "Your edits to this profile haven't been saved yet.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setDiscarding(true);
            repeat();
          },
        },
      ]);
    }, []),
  );

  function set<K extends keyof ProfileForm>(field: K, value: ProfileForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: null }));
    setFormError(null);
    setSaved(false);
  }

  /** The photo to show right now: a fresh choice, a removal, or what is stored. */
  const shownPhotoUri = pendingPhoto
    ? pendingPhoto.previewUri
    : photoRemoved
      ? null
      : (storedPhoto.data?.data_uri ?? null);

  async function choosePhoto() {
    setPhotoError(null);
    const result = await pickProfilePhoto();
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      setPhotoError("We couldn't use that photo. Try choosing another one.");
      return;
    }

    setPendingPhoto({
      previewUri: result.photo.previewUri,
      data: result.photo.data,
      contentType: result.photo.contentType,
    });
    setPhotoRemoved(false);
    setSaved(false);
  }

  function validate(): FieldErrors | null {
    const found: FieldErrors = {
      name: validateName(form.name),
      miLifestyleId: validateMiLifestyleId(form.miLifestyleId),
      phoneNumber: validatePhoneNumber(form.phoneNumber),
      notes: validateNotes(form.notes),
      joiningDate: validateJoiningDate(
        form.joiningDate ? new Date(`${form.joiningDate}T12:00:00`) : null,
      ),
    };
    return Object.values(found).some(Boolean) ? found : null;
  }

  /** Put the backend's answer on the field it belongs to, not in a general banner. */
  function applyServerError(error: unknown) {
    if (!isApiError(error)) {
      setFormError(error);
      return;
    }
    switch (error.code) {
      case "mi_lifestyle_id_taken":
        setErrors((current) => ({
          ...current,
          miLifestyleId: "That Mi Lifestyle ID is already registered in your team.",
        }));
        return;
      // Out of reach while the form checks the same rule first, but if the backend
      // refuses one, it belongs on the field rather than in a banner.
      case "mi_lifestyle_id_invalid":
      case "mi_lifestyle_id_required":
        setErrors((current) => ({
          ...current,
          miLifestyleId: "Enter the 10-digit Mi Lifestyle ID.",
        }));
        return;
      case "sponsor_not_found":
        setErrors((current) => ({
          ...current,
          sponsorId: "That sponsor is no longer available. Choose another.",
        }));
        return;
      case "sponsor_invalid":
        setErrors((current) => ({
          ...current,
          sponsorId: "A member can't be recorded as their own sponsor.",
        }));
        return;
      // Both should be out of reach — the photo is resized and re-encoded before it
      // is sent — but if the backend refuses one, say why rather than generically.
      case "photo_too_large":
        setPhotoError("That photo is still too large to save. Choose a different one.");
        return;
      case "invalid_photo":
        setPhotoError("We couldn't read that photo. Choose another one.");
        return;
      default:
        setFormError(error);
    }
  }

  function save() {
    if (isSaving) return;
    // The backstop behind the disabled button, for a connection that dropped between
    // the render and the tap. See `OfflineWriteBlock`.
    if (!isOnline) return;

    setFormError(null);
    const found = validate();
    setErrors(found ?? {});
    if (found) return;

    const changes = changedFields(form, member);
    if (Object.keys(changes).length === 0 && !photoChanged) {
      setSaved(true);
      return;
    }

    void (async () => {
      try {
        // The photo goes first: it is the change most likely to be refused, and a
        // rejected photo should not leave the text fields already saved.
        if (photoChanged) {
          await savePhoto.mutateAsync(
            pendingPhoto
              ? { content_type: pendingPhoto.contentType, data: pendingPhoto.data }
              : null,
          );
        }
        if (Object.keys(changes).length > 0) {
          await update.mutateAsync(changes);
        }
        setPendingPhoto(null);
        setPhotoRemoved(false);
        setSaved(true);
      } catch (error) {
        applyServerError(error);
      }
    })();
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
            title="We couldn't save these changes"
            onRetry={save}
            isRetrying={isSaving}
          />
        ) : null}

        {saved ? (
          <View accessibilityLiveRegion="polite" style={styles.savedBanner}>
            <Icon name="check_circle" size={22} color={colors.semantic.success} />
            <Text maxFontSizeMultiplier={1.3} style={styles.savedText}>
              {isLeader ? "Your profile is saved." : `${member.name} is saved.`}
            </Text>
          </View>
        ) : null}

        <FormSection
          icon="person"
          title="Personal information"
          subtitle={
            isLeader
              ? "How you appear across UrLynk"
              : "Who this member is"
          }
        >
          {isLeader ? (
            <PhotoField
              initials={form.name.trim() ? form.name : member.name}
              photoUri={shownPhotoUri}
              // `isLoading`, not `isPending`: the photo query is disabled when the
              // member has none, and a disabled query stays "pending" forever, which
              // would leave a skeleton where their initials belong.
              loading={storedPhoto.isLoading && !photoChanged}
              error={photoError}
              onChoose={() => void choosePhoto()}
            />
          ) : null}

          <TextField
            label={isLeader ? "Preferred name" : "Full name"}
            value={form.name}
            onChangeText={(value) => set("name", value)}
            placeholder="e.g. Palanivel"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MEMBER_LIMITS.name}
            error={errors.name}
            hint={
              isLeader
                ? "Used everywhere in UrLynk. Your sign-in account keeps its own name."
                : undefined
            }
          />
          <TextField
            label="Phone number"
            value={form.phoneNumber}
            onChangeText={(value) => set("phoneNumber", value)}
            placeholder="e.g. +91 98765 43210"
            keyboardType="phone-pad"
            maxLength={MEMBER_LIMITS.phoneNumber}
            error={errors.phoneNumber}
            optional
          />
        </FormSection>

        <FormSection
          icon="badge"
          title="Business information"
          subtitle="Mi Lifestyle details on record"
        >
          <TextField
            label="Mi Lifestyle ID"
            value={form.miLifestyleId}
            onChangeText={(value) => set("miLifestyleId", value)}
            placeholder="e.g. 0012345678"
            keyboardType="number-pad"
            autoCorrect={false}
            maxLength={MEMBER_LIMITS.miLifestyleId}
            error={errors.miLifestyleId}
            hint="Exactly 10 digits, as issued. Leading zeros are kept."
          />

          <FieldShell label="Joining date" optional error={errors.joiningDate}>
            <SelectRow
              icon="event"
              placeholder="Not recorded"
              value={form.joiningDate ? formatIsoDate(form.joiningDate) : null}
              onPress={() => setDatePickerOpen(true)}
              onClear={form.joiningDate ? () => set("joiningDate", null) : undefined}
            />
          </FieldShell>
        </FormSection>

        <FormSection
          icon="more_horiz"
          title="Additional details"
          subtitle="Useful later, and all optional"
        >
          {isLeader ? null : (
            <FieldShell
              label="Sponsored by"
              optional
              error={errors.sponsorId}
              hint="Who introduced this member. Independent of where they sit in the team."
            >
              <SelectRow
                icon="handshake"
                placeholder="Not recorded"
                value={form.sponsorId ? sponsorName : null}
                onPress={() => setSponsorPickerOpen(true)}
                onClear={
                  form.sponsorId
                    ? () => {
                        set("sponsorId", null);
                        setSponsorName(null);
                      }
                    : undefined
                }
              />
            </FieldShell>
          )}

          <TextField
            label="Notes"
            value={form.notes}
            onChangeText={(value) => set("notes", value)}
            placeholder={
              isLeader
                ? "Anything you want to keep with your profile"
                : "Anything worth remembering about this member"
            }
            multiline
            maxLength={MEMBER_LIMITS.notes}
            error={errors.notes}
            optional
          />
        </FormSection>

        {isLeader ? (
          <View style={styles.identityNote}>
            <Icon name="info" size={18} color={colors.ui.textSecondary} />
            <Text maxFontSizeMultiplier={1.3} style={styles.identityNoteText}>
              Your sign-in email and verified account are managed separately and are not
              changed here.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {isOnline ? null : <OfflineWriteBlock action="Saving a profile" />}
        <Button
          label="Save Changes"
          icon="check"
          loading={isSaving}
          disabled={!dirty || !isOnline}
          onPress={save}
          accessibilityHint={
            !isOnline
              ? "Unavailable without a connection"
              : dirty
                ? "Saves your edits"
                : "Nothing has changed yet"
          }
        />
        <Button
          label="Cancel"
          variant="ghost"
          disabled={isSaving}
          onPress={() => router.back()}
        />
      </View>

      <MemberPicker
        visible={sponsorPickerOpen}
        mode="sponsor"
        selectedId={form.sponsorId ?? undefined}
        onClose={() => setSponsorPickerOpen(false)}
        onSelect={(picked) => {
          set("sponsorId", picked.id);
          setSponsorName(picked.name);
          setSponsorPickerOpen(false);
        }}
      />

      {datePickerOpen ? (
        <DateTimePicker
          value={form.joiningDate ? new Date(`${form.joiningDate}T12:00:00`) : new Date()}
          mode="date"
          presentation="dialog"
          minimumDate={EARLIEST_JOINING_DATE}
          maximumDate={new Date()}
          accentColor={colors.interaction.primary}
          onValueChange={(_event, date) => {
            set("joiningDate", toIsoDate(date));
            setDatePickerOpen(false);
          }}
          onDismiss={() => setDatePickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** The profile photo, with a preview of a new choice before it is saved. */
function PhotoField({
  initials,
  photoUri,
  loading,
  error,
  onChoose,
}: {
  initials: string;
  photoUri: string | null;
  loading: boolean;
  error: string | null;
  onChoose: () => void;
}) {
  return (
    <View style={styles.photoBlock}>
      <View style={styles.photoRow}>
        {loading ? (
          <Skeleton width={84} height={84} corner={radius.pill} />
        ) : (
          <Avatar
            size={84}
            initials={initialsFor(initials)}
            imageUri={photoUri}
            ringColor={colors.interaction.primaryLight}
          />
        )}

        <View style={styles.photoActions}>
          <Text maxFontSizeMultiplier={1.3} style={styles.photoLabel}>
            Profile photograph
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.photoHint}>
            {photoUri
              ? "Shown wherever you appear in UrLynk."
              : "Your initials are shown until you add one."}
          </Text>
          <View style={styles.photoButtons}>
            <Button
              label={photoUri ? "Change" : "Add photo"}
              icon="photo_camera"
              variant="secondary"
              compact
              onPress={onChoose}
            />
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.messageRow}>
          <Icon name="error" size={16} color={statusColors.error.icon} />
          <Text maxFontSizeMultiplier={1.3} style={styles.error}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function FormSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: IconName;
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

/** A read-only row that opens a picker: shows what is chosen, or a placeholder. */
function SelectRow({
  icon,
  placeholder,
  value,
  onPress,
  onClear,
}: {
  icon: IconName;
  placeholder: string;
  value: string | null;
  onPress: () => void;
  onClear?: () => void;
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
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={[
            styles.selectValue,
            value ? styles.selectValueChosen : styles.selectPlaceholder,
          ]}
        >
          {value ?? placeholder}
        </Text>
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

function LoadingForm() {
  return (
    <View
      accessibilityLabel="Loading this profile"
      accessible
      style={[styles.content, styles.loading]}
    >
      <ActivityIndicator size="large" color={colors.interaction.primary} />
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
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.82,
  },
  savedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: `${colors.semantic.success}33`,
    backgroundColor: statusColors.success.background,
  },
  savedText: {
    ...typography.bodyMedium,
    flex: 1,
    fontFamily: fontFamily.medium,
    color: colors.ui.textPrimary,
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
  photoBlock: {
    gap: spacing.sm,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
  },
  photoActions: {
    flex: 1,
    gap: spacing.xs,
  },
  photoLabel: {
    ...componentTokens.input.labelTypography,
    color: colors.ui.textPrimary,
  },
  photoHint: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
  photoButtons: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
  identityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  identityNoteText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textSecondary,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  error: {
    ...typography.bodySmall,
    flex: 1,
    fontFamily: fontFamily.medium,
    color: colors.semantic.error,
  },
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.ui.border,
    backgroundColor: colors.ui.surface,
  },
});
