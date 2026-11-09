/**
 * Inter families, registered by useFonts in src/app/_layout.tsx.
 *
 * Each weight is its own family. Do not add fontWeight to these styles: Android
 * alters a loaded face when a weight is also set, which can fake the bold.
 */
export const fontFamily = {
  regular: "Inter-Regular", // 400
  medium: "Inter-Medium", // 500
  semiBold: "Inter-SemiBold", // 600
  bold: "Inter-Bold", // 700
} as const;

/** Line heights are size × ratio, in absolute units as React Native requires. */
const scale = {
  h1: { fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 38.4 },
  h2: { fontFamily: fontFamily.semiBold, fontSize: 24, lineHeight: 31.2 },
  h3: { fontFamily: fontFamily.semiBold, fontSize: 20, lineHeight: 26 },
  h4: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 22.4 },
  bodyLarge: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 25.6 },
  bodyMedium: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 22.4 },
  bodySmall: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 19.2 },
  caption: { fontFamily: fontFamily.regular, fontSize: 11, lineHeight: 15.4 },
} as const;

export const typography = {
  ...scale,
  button: scale.h4,
  inputLabel: { ...scale.bodyMedium, fontFamily: fontFamily.medium },
  navigationLabel: { ...scale.bodySmall, fontFamily: fontFamily.medium },
  // No lineHeight: Android TextInput clips or shifts text when one is set.
  input: { fontFamily: fontFamily.regular, fontSize: scale.bodyLarge.fontSize },
} as const;
