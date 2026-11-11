import { Image, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, gradients } from "@/theme";

/** The account photo when one exists, otherwise initials on the brand gradient. */
export function Avatar({
  size,
  initials,
  imageUrl,
  ringColor = colors.neutral.white,
}: {
  size: number;
  initials: string;
  imageUrl: string | null;
  ringColor?: string;
}) {
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: Math.max(2, size / 22),
    borderColor: ringColor,
  };

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.image, frame]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.initialsFrame, frame]}>
      <Text
        allowFontScaling={false}
        style={[styles.initials, { fontSize: size * 0.36 }]}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.interaction.primaryLight,
  },
  initialsFrame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.indigo,
    backgroundImage: `linear-gradient(135deg, ${gradients.bluePurple.start}, ${gradients.bluePurple.end})`,
  },
  initials: {
    fontFamily: fontFamily.semiBold,
    color: colors.neutral.white,
    includeFontPadding: false,
  },
});
