import { useState, type ComponentProps } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/icon";
import {
  colors,
  componentTokens,
  fontFamily,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

type TextInputProps = ComponentProps<typeof TextInput>;

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Shown under the field in red, and highlights the border. */
  error?: string | null;
  /** Shown under the field in grey when there is no error. */
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
} & Pick<
  TextInputProps,
  | "placeholder"
  | "keyboardType"
  | "autoCapitalize"
  | "autoCorrect"
  | "autoFocus"
  | "maxLength"
  | "returnKeyType"
  | "onSubmitEditing"
  | "textContentType"
>;

/** A labelled input with its own validation message. */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  optional = false,
  multiline = false,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? componentTokens.input.errorBorder
    : focused
      ? componentTokens.input.focusedBorder
      : componentTokens.input.border;

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text maxFontSizeMultiplier={1.3} style={styles.label}>
          {label}
        </Text>
        {optional ? (
          <Text maxFontSizeMultiplier={1.3} style={styles.optional}>
            Optional
          </Text>
        ) : null}
      </View>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline={multiline}
        placeholderTextColor={componentTokens.input.placeholder}
        maxFontSizeMultiplier={1.3}
        accessibilityLabel={`${label}${optional ? ", optional" : ""}`}
        style={[
          styles.input,
          multiline && styles.multiline,
          { borderColor, borderWidth: focused || error ? 1.5 : 1 },
        ]}
        {...inputProps}
      />

      {error ? (
        <View style={styles.messageRow}>
          <Icon name="error" size={16} color={statusColors.error.icon} />
          <Text maxFontSizeMultiplier={1.3} style={styles.error}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A read-only field that opens something else, such as the date picker. */
export function FieldShell({
  label,
  optional = false,
  error,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text maxFontSizeMultiplier={1.3} style={styles.label}>
          {label}
        </Text>
        {optional ? (
          <Text maxFontSizeMultiplier={1.3} style={styles.optional}>
            Optional
          </Text>
        ) : null}
      </View>
      {children}
      {error ? (
        <View style={styles.messageRow}>
          <Icon name="error" size={16} color={statusColors.error.icon} />
          <Text maxFontSizeMultiplier={1.3} style={styles.error}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  label: {
    ...componentTokens.input.labelTypography,
    color: colors.ui.textPrimary,
  },
  optional: {
    ...typography.caption,
    fontFamily: fontFamily.medium,
    color: colors.ui.textSecondary,
  },
  input: {
    ...componentTokens.input.typography,
    height: componentTokens.input.height,
    paddingHorizontal: spacing.base,
    paddingVertical: 0,
    borderRadius: radius.md,
    backgroundColor: componentTokens.input.background,
    color: colors.ui.textPrimary,
    includeFontPadding: false,
  },
  multiline: {
    height: 104,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    textAlignVertical: "top",
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
  hint: {
    ...typography.bodySmall,
    color: colors.ui.textSecondary,
  },
});
