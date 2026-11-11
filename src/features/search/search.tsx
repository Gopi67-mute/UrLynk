import { StyleSheet, TextInput, View } from "react-native";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { PageHeader, TabScreen } from "@/components/tab-screen";
import {
  colors,
  componentTokens,
  radius,
  spacing,
} from "@/theme";

/**
 * Search runs against the backend, which arrives in a later phase. The field is
 * shown so the layout is settled, but stays disabled until results are real.
 */
export default function Search() {
  return (
    <TabScreen>
      <PageHeader title="Search" subtitle="Find members in your team" />

      <View style={styles.field}>
        <Icon name="search" size={22} color={colors.ui.icon} />
        <TextInput
          editable={false}
          placeholder="Search by name or Mi Lifestyle ID"
          placeholderTextColor={componentTokens.input.placeholder}
          maxFontSizeMultiplier={1.3}
          accessibilityLabel="Member search, not available yet"
          accessibilityState={{ disabled: true }}
          style={styles.input}
        />
      </View>

      <EmptyState
        icon="person_search"
        title="Member search isn't available yet"
        message="Searching your team by member name or ID will work once your team data is connected."
      />
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    height: componentTokens.input.height,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.pill,
    borderColor: colors.ui.border,
    backgroundColor: colors.ui.disabledBackground,
  },
  input: {
    ...componentTokens.input.typography,
    flex: 1,
    height: "100%",
    paddingVertical: 0,
    color: colors.ui.textPrimary,
    includeFontPadding: false,
  },
});
