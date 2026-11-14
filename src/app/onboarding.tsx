import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  componentTokens,
  fontFamily,
  gradients,
  radius,
  spacing,
  typography,
} from "@/theme";

const LOGO_ASPECT_RATIO = 2172 / 724;
const LOGO_SCREEN_WIDTH_RATIO = 0.73;
const TEAM_IMAGE_ASPECT_RATIO = 1536 / 1024;
const TEAM_IMAGE_MIN_HEIGHT = 160;
const TEAM_IMAGE_FADE_HEIGHT = spacing.xl;
const SHORT_SCREEN_HEIGHT = 640;

/** The same soft wave backdrop the authentication screen uses, at the same scale. */
const WAVE_TOP_ASPECT_RATIO = 1080 / 360;
const WAVE_BOTTOM_ASPECT_RATIO = 1080 / 260;

/** How much higher the artwork and the button sit now that a wave fills the foot. */
const ART_LIFT = spacing.base;
const BUTTON_LIFT = spacing.xl;

/**
 * The team photo is landscape, so matching the reference means running it past
 * both screen edges. The shift centers the leader and keeps the arrow on screen;
 * only the left ribbon loop and the outer edge of the left member are cut off.
 */
const TEAM_IMAGE_SCREEN_WIDTH_RATIO = 1.2;
const TEAM_IMAGE_SCREEN_SHIFT_RATIO = -0.08;

const GROWTH_HEADLINE = "Your Growth.";

/** React Native cannot gradient-fill text, so each letter gets one step of it. */
const GROWTH_LETTER_COLORS = Array.from(GROWTH_HEADLINE, (_, index) =>
  mixHexColors(
    gradients.bluePurple.start,
    gradients.bluePurple.end,
    index / (GROWTH_HEADLINE.length - 1),
  ),
);

function mixHexColors(from: string, to: string, amount: number) {
  const channels = [1, 3, 5].map((offset) => {
    const start = parseInt(from.slice(offset, offset + 2), 16);
    const end = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function Onboarding() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const logoWidth = width * LOGO_SCREEN_WIDTH_RATIO;
  const headlineFontSize = clamp(width * 0.095, 28, 40);
  const headlineLineHeight =
    headlineFontSize * (typography.h1.lineHeight / typography.h1.fontSize);
  const teamImageWidth = width * TEAM_IMAGE_SCREEN_WIDTH_RATIO;

  // Spare height on taller phones goes above the logo, as in the reference.
  const spareHeight = height - SHORT_SCREEN_HEIGHT;
  const topSpacing = Math.max(
    insets.top + spacing.sm,
    Math.min(spareHeight * 0.75, height * 0.15),
  );

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Backdrop width={width} />

      {/* Only scrolls when large system fonts outgrow a short screen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topSpacing }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View
          style={[
            styles.intro,
            { gap: clamp(height * 0.05, spacing.md, spacing.section) },
          ]}
        >
          {/* The tagline is part of this artwork, so it is not repeated as text. */}
          <Image
            source={require("../../assets/images/urlynk-splash-logo.png")}
            style={{
              width: logoWidth,
              height: logoWidth / LOGO_ASPECT_RATIO,
            }}
            resizeMode="contain"
            fadeDuration={0}
            accessibilityRole="image"
            accessibilityLabel="UrLynk logo. Its Ur life. Its Ur style"
          />

          <View style={styles.message}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
              style={[
                styles.headline,
                { fontSize: headlineFontSize, lineHeight: headlineLineHeight },
              ]}
            >
              <Text style={styles.headlineDark}>Your Team.{"\n"}</Text>
              {Array.from(GROWTH_HEADLINE, (letter, index) => (
                <Text
                  key={index}
                  style={{ color: GROWTH_LETTER_COLORS[index] }}
                >
                  {letter}
                </Text>
              ))}
            </Text>
            <Text style={styles.quote}>
              Connect <Text style={styles.quoteDot}>•</Text> Grow{" "}
              <Text style={styles.quoteDot}>•</Text> Thrive
            </Text>
          </View>
        </View>

        {/* On short screens "contain" shrinks the photo without distorting it. */}
        <Image
          source={require("../../assets/images/getStartedPage.png")}
          style={[
            styles.teamImage,
            {
              width: teamImageWidth,
              maxHeight: teamImageWidth / TEAM_IMAGE_ASPECT_RATIO,
              transform: [
                { translateX: width * TEAM_IMAGE_SCREEN_SHIFT_RATIO },
              ],
            },
          ]}
          resizeMode="contain"
          fadeDuration={0}
          accessibilityRole="image"
          accessibilityLabel="A team of business professionals around their leader"
        />
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom:
              Math.max(insets.bottom, spacing.base) +
              clamp(spareHeight * 0.2, spacing.sm, spacing.xxxl) +
              BUTTON_LIFT,
          },
        ]}
      >
        {/* Carries the fade that used to be the footer's own background. The footer
            itself is transparent now, so the bottom wave shows through behind the
            button instead of being painted over. */}
        <View style={styles.footerFade} pointerEvents="none" />
        <TouchableOpacity
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={() => router.push("/auth")}
          style={styles.cta}
        >
          <Text style={styles.ctaLabel}>Get Started →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Soft lavender and mint waves scaled to the screen width, behind all content. */
function Backdrop({ width }: { width: number }) {
  return (
    <View style={styles.backdrop} pointerEvents="none">
      <Image
        source={require("../../assets/images/auth-wave-top.png")}
        style={{ width, height: width / WAVE_TOP_ASPECT_RATIO }}
        fadeDuration={0}
      />
      <Image
        source={require("../../assets/images/auth-wave-bottom.png")}
        style={[
          styles.waveBottom,
          { width, height: width / WAVE_BOTTOM_ASPECT_RATIO },
        ]}
        fadeDuration={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ui.surface,
    backgroundImage: `radial-gradient(circle at 0% 0%, ${colors.interaction.primaryLight} 0%, ${colors.ui.surface} 40%)`,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
  },
  intro: {
    alignItems: "center",
  },
  message: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  headline: {
    fontFamily: typography.h1.fontFamily,
    textAlign: "center",
  },
  headlineDark: {
    color: colors.ui.textPrimary,
  },
  quote: {
    ...typography.h4,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
  quoteDot: {
    color: colors.brand.indigo,
  },
  teamImage: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignSelf: "center",
    minHeight: TEAM_IMAGE_MIN_HEIGHT,
    marginBottom: ART_LIFT,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  waveBottom: {
    position: "absolute",
    bottom: 0,
  },
  footer: {
    // Overlaps the photo so its flat bottom edge fades out above the button.
    marginTop: -TEAM_IMAGE_FADE_HEIGHT,
    paddingHorizontal: spacing.xl,
  },
  footerFade: {
    // Full-bleed: the artwork is wider than the screen, so its edge is too.
    marginHorizontal: -spacing.xl,
    marginBottom: spacing.xs,
    height: TEAM_IMAGE_FADE_HEIGHT,
    backgroundImage: `linear-gradient(180deg, ${colors.ui.surface}00 0%, ${colors.ui.surface} 100%)`,
  },
  cta: {
    height: componentTokens.button.height,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brand.indigo,
    backgroundImage: `linear-gradient(90deg, ${gradients.bluePurple.start}, ${gradients.bluePurple.end})`,
    boxShadow: `0px 8px 20px ${colors.brand.indigo}47`,
  },
  ctaLabel: {
    ...componentTokens.button.typography,
    fontFamily: fontFamily.semiBold,
    color: colors.neutral.white,
  },
});
