import Constants from "expo-constants";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAccountProfile } from "@/auth/account";
import { useSignOut } from "@/auth/session";
import { Avatar } from "@/components/avatar";
import { Icon, type IconName } from "@/components/icon";
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

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Settings() {
  const account = useAccountProfile();
  const { requestSignOut, isSigningOut, signOutFailed } = useSignOut();
  const appVersion = Constants.expoConfig?.version;

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need to sign in again to see your team.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: requestSignOut },
    ]);
  }

  return (
    <TabScreen>
      <PageHeader title="Settings" subtitle="Your account and app details" />

      <View style={styles.profileCard}>
        <Avatar
          size={60}
          initials={account.initials}
          imageUrl={account.imageUrl}
          ringColor={colors.interaction.primaryLight}
        />
        <View style={styles.profileText}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.profileName}>
            {account.displayName}
          </Text>
          {account.email ? (
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.profileEmail}>
              {account.email}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.group}>
        <Text maxFontSizeMultiplier={1.3} style={styles.groupTitle}>
          Account
        </Text>
        <View style={styles.groupCard}>
          <InfoRow icon="mail" label="Email" value={account.email ?? "Not set"} />
          <InfoRow icon="badge" label="Role" value="Team Leader" />
          {account.createdAt ? (
            <InfoRow
              icon="calendar_month"
              label="Member since"
              value={formatDate(account.createdAt)}
              isLast
            />
          ) : null}
        </View>
      </View>

      {appVersion ? (
        <View style={styles.group}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupTitle}>
            App
          </Text>
          <View style={styles.groupCard}>
            <InfoRow icon="smartphone" label="Version" value={appVersion} isLast />
          </View>
        </View>
      ) : null}

      <View style={styles.signOutBlock}>
        <TouchableOpacity
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ busy: isSigningOut, disabled: isSigningOut }}
          disabled={isSigningOut}
          onPress={confirmSignOut}
          style={styles.signOutButton}
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.semantic.error} />
          ) : (
            <>
              <Icon name="logout" size={22} color={colors.semantic.error} />
              <Text maxFontSizeMultiplier={1.3} style={styles.signOutLabel}>
                Sign Out
              </Text>
            </>
          )}
        </TouchableOpacity>

        {signOutFailed ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            We couldn't sign you out. Check your connection and try again.
          </Text>
        ) : null}
      </View>
    </TabScreen>
  );
}

function InfoRow({
  icon,
  label,
  value,
  isLast = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={20} color={colors.interaction.primary} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.rowLabel}>
        {label}
      </Text>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
    boxShadow: `0px 4px 16px ${colors.brand.indigo}0F`,
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    ...typography.h3,
    fontFamily: fontFamily.bold,
    color: colors.ui.textPrimary,
  },
  profileEmail: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
  },
  group: {
    gap: spacing.sm,
  },
  groupTitle: {
    ...typography.bodySmall,
    fontFamily: fontFamily.semiBold,
    paddingHorizontal: spacing.xs,
    color: colors.ui.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  groupCard: {
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: componentTokens.card.border,
    backgroundColor: componentTokens.card.background,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ui.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  rowLabel: {
    ...typography.inputLabel,
    color: colors.ui.textPrimary,
  },
  rowValue: {
    ...typography.bodyMedium,
    flex: 1,
    textAlign: "right",
    color: colors.ui.textSecondary,
  },
  signOutBlock: {
    gap: spacing.sm,
  },
  signOutButton: {
    height: componentTokens.button.height,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    borderColor: `${colors.semantic.error}66`,
    backgroundColor: statusColors.error.background,
  },
  signOutLabel: {
    ...componentTokens.button.typography,
    fontFamily: fontFamily.semiBold,
    color: statusColors.error.text,
  },
  error: {
    ...typography.bodySmall,
    color: statusColors.error.text,
    textAlign: "center",
  },
});
