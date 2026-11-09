import { colors } from "./colors";

/** Reusable endpoint definitions; consume with a native gradient component. */
export const gradients = {
  primary: { start: colors.brand.violet, end: colors.brand.purple },
  green: { start: colors.brand.green, end: "#06B6D4" },
  blue: { start: colors.brand.blue, end: "#6366F1" },
} as const;

export type GradientName = keyof typeof gradients;
