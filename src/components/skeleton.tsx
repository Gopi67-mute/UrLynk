import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View, type DimensionValue } from "react-native";
import { colors, radius, spacing } from "@/theme";

/**
 * A placeholder for content that is on its way.
 *
 * One slow opacity loop, nothing more: it should read as "loading", not as decoration.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  corner = radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  corner?: number;
}) {
  // useState, not useRef: the value is read while rendering, and a ref must not be.
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: corner,
        backgroundColor: colors.neutral.gray200,
        opacity: pulse,
      }}
    />
  );
}

/** The card-shaped skeleton used while a member or a branch slot loads. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Loading" accessible style={styles.card}>
      <Skeleton width={44} height={44} corner={radius.pill} />
      <View style={styles.cardLines}>
        <Skeleton width="70%" height={16} />
        {Array.from({ length: lines - 1 }, (_, index) => (
          <Skeleton key={index} width="45%" height={12} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: colors.ui.border,
    backgroundColor: colors.ui.surface,
  },
  cardLines: {
    flex: 1,
    gap: spacing.sm,
  },
});
