import { Image, StyleSheet, Text, View } from "react-native";
import { useMemberPhoto } from "@/hooks/use-members";
import { initialsFor } from "@/lib/names";
import { colors, fontFamily, placementStyle, radius, type PlacementSide } from "@/theme";

/** Just enough of a member to draw their face: whoever they are, and which photo. */
export type FaceMember = {
  id: string;
  name: string;
  /** The photo's version, or null when the member has none. */
  photo_updated_at: string | null;
};

/**
 * A member's profile photograph, falling back to their initials.
 *
 * One component for every place a member appears in a list or a card — branch cards,
 * Recently Added, placement and sponsor cards — so the same person is never drawn with
 * a photo on one screen and initials on another.
 *
 * Nothing is requested for a member who has no photo: `photo_updated_at` is null, which
 * leaves the query disabled. For a member who has one, the image is fetched once per
 * version and then read from cache, so scrolling past the same face again is free. The
 * initials show while it loads and if it fails, rather than a gap where a face should be.
 *
 * `side` tints the frame to match the branch the member sits on, which is how the rest
 * of the app colours a placement: green for LEFT, blue for RIGHT.
 */
export function MemberFace({
  member,
  size = 44,
  side,
  dashedWhenEmpty = false,
}: {
  member: FaceMember;
  size?: number;
  side?: PlacementSide;
  dashedWhenEmpty?: boolean;
}) {
  const photo = useMemberPhoto(member.id, member.photo_updated_at);
  const imageUri = photo.data?.data_uri ?? null;

  const accent = side ? placementStyle[side].accent : colors.interaction.primary;
  const tint = side ? placementStyle[side].tint : colors.interaction.primaryLight;
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: `${accent}55`,
  };

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={[styles.face, styles.image, frame, { backgroundColor: tint }]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View
      style={[
        styles.face,
        frame,
        { backgroundColor: tint },
        dashedWhenEmpty && styles.dashed,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.initials, { color: accent, fontSize: size * 0.34 }]}
      >
        {initialsFor(member.name)}
      </Text>
    </View>
  );
}

/** The same frame with no member in it: an open position, or one that failed to load. */
export function EmptyFace({
  size = 44,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.face,
        styles.dashed,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.neutral.white,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  image: {
    borderWidth: 1,
  },
  dashed: {
    borderStyle: "dashed",
    borderColor: colors.ui.borderStrong,
  },
  initials: {
    fontFamily: fontFamily.bold,
    includeFontPadding: false,
  },
});
