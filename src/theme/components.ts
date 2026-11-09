import { colors, statusColors } from "./colors";
import { radius } from "./radius";
import { spacing } from "./spacing";
import { typography } from "./typography";

/** Shared visual recipes for components as they are introduced. */
export const componentTokens = {
  button: {
    height: 52,
    radius: radius.md,
    paddingHorizontal: spacing.xl,
    primary: { background: colors.interaction.primary, foreground: colors.neutral.white },
    pressed: { background: colors.interaction.primaryPressed },
    secondary: { background: colors.ui.surface, foreground: colors.interaction.primary, border: colors.interaction.primary },
    tertiary: { background: "transparent", foreground: colors.interaction.primary },
    disabled: { background: colors.ui.disabledBackground, foreground: colors.ui.disabledForeground },
    typography: typography.button,
  },
  card: {
    background: colors.ui.surface,
    border: colors.ui.border,
    radius: radius.lg,
    padding: spacing.base,
    elevation: 1,
  },
  input: {
    height: 52,
    radius: radius.md,
    background: colors.ui.inputBackground,
    border: colors.ui.inputBorder,
    focusedBorder: colors.ui.focus,
    errorBorder: colors.semantic.error,
    placeholder: colors.neutral.gray600,
    labelTypography: typography.inputLabel,
    typography: typography.input,
  },
  status: statusColors,
  navigation: {
    destinations: ["Home", "Team", "Search", "Settings"] as const,
    active: colors.ui.iconActive,
    inactive: colors.ui.icon,
    background: colors.ui.surface,
    border: colors.ui.border,
    labelTypography: typography.navigationLabel,
  },
} as const;
