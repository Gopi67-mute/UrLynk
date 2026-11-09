/** UrLynk colors for non-className props. global.css holds the same tokens. */
const brand = {
  violet: "#6C3AED",
  purple: "#8B5CF6",
  green: "#10B981",
  blue: "#3B82F6",
} as const;

const semantic = {
  success: "#22C55E",
  info: brand.blue,
  warning: "#F59E0B",
  error: "#EF4444",
  secondary: brand.purple,
} as const;

const neutral = {
  white: "#FFFFFF",
  gray50: "#F8FAFC",
  gray100: "#F1F5F9",
  gray200: "#E2E8F0",
  gray300: "#CBD5E1",
  gray600: "#475569",
  gray900: "#0F172A",
} as const;

const interaction = {
  primary: brand.violet,
  primaryPressed: "#5B21B6",
  primaryLight: "#EDE9FE",
} as const;

export const colors = {
  brand,
  semantic,
  neutral,
  interaction,
  ui: {
    screen: neutral.gray50,
    surface: neutral.white,
    textPrimary: neutral.gray900,
    textSecondary: neutral.gray600,
    border: neutral.gray200,
    borderStrong: neutral.gray300,
    inputBackground: neutral.white,
    inputBorder: neutral.gray300,
    focus: interaction.primary,
    disabledBackground: neutral.gray100,
    disabledForeground: neutral.gray600,
    overlay: neutral.gray900,
    icon: neutral.gray600,
    iconActive: interaction.primary,
  },
} as const;

export type BrandColor = keyof typeof colors.brand;
export type SemanticColor = keyof typeof colors.semantic;

/**
 * Status message styling. Semantic colors are too light for text on their
 * tints, so the color goes on the icon and the text stays Gray 900.
 */
export const statusColors = {
  success: { icon: semantic.success, text: neutral.gray900, background: "#ECFDF5" },
  info: { icon: semantic.info, text: neutral.gray900, background: "#EFF6FF" },
  warning: { icon: semantic.warning, text: neutral.gray900, background: "#FFFBEB" },
  error: { icon: semantic.error, text: neutral.gray900, background: "#FEF2F2" },
} as const;
