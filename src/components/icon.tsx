import { type AndroidSymbol, SymbolView } from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { colors } from "@/theme";

export type IconName = AndroidSymbol;

/**
 * Material Symbols, drawn from a font on Android, so no native code is needed.
 * The font is preloaded with Inter in the root layout to avoid a blank frame.
 */
export function Icon({
  name,
  size = 24,
  color = colors.ui.icon,
  style,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SymbolView
      name={{ android: name, web: name }}
      size={size}
      tintColor={color}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
