import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, gradients } from "@/theme";

/**
 * The member's photo when one exists, otherwise initials on the brand gradient.
 *
 * `imageUri` is usually a data URI: the leader's saved photo travels inside the API
 * response rather than as a URL, because a photo URL would need an Authorization
 * header that expires within the minute. A remote URL works just as well.
 *
 * The image is cropped to a circle and fills the frame without distortion, so a
 * portrait or a landscape original is centred rather than squashed.
 */
export function Avatar({
  size,
  initials,
  imageUri,
  ringColor = colors.neutral.white,
}: {
  size: number;
  initials: string;
  imageUri: string | null;
  ringColor?: string;
}) {
  // The image that failed to load, rather than a boolean: a new one is therefore
  // retried automatically, with no effect needed to reset the flag.
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);

  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: Math.max(2, size / 22),
    borderColor: ringColor,
  };

  if (imageUri && failedImageUri !== imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={[styles.image, frame]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onError={() => setFailedImageUri(imageUri)}
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
