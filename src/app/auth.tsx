import { StatusBar } from "expo-status-bar";
import { type ComponentRef, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AuthNotConnectedError,
  type AuthMode,
  continueWithEmail,
} from "@/auth/authClient";
import {
  colors,
  componentTokens,
  fontFamily,
  gradients,
  radius,
  spacing,
  statusColors,
  typography,
} from "@/theme";

const LOGO_ASPECT_RATIO = 2172 / 724;
const LOGO_SCREEN_WIDTH_RATIO = 0.62;
const TEAM_IMAGE_ASPECT_RATIO = 1536 / 1024;
const TEAM_IMAGE_MIN_HEIGHT = 120;
const TEAM_IMAGE_FADE_HEIGHT = spacing.xl;
const WAVE_TOP_ASPECT_RATIO = 1080 / 360;
const WAVE_BOTTOM_ASPECT_RATIO = 1080 / 260;
const SCREEN_GUTTER = spacing.lg;

/** Holds the validation message, so showing one does not push the form down. */
const MESSAGE_SLOT_HEIGHT = spacing.xl;
const SEPARATOR_HEIGHT = spacing.lg;
const FOOTER_HEIGHT = 44;

const FORM_HEIGHT =
  componentTokens.input.height +
  MESSAGE_SLOT_HEIGHT +
  componentTokens.button.height +
  spacing.md +
  SEPARATOR_HEIGHT +
  spacing.md +
  componentTokens.button.height * 2 +
  spacing.md;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MODE_CONTENT: Record<
  AuthMode,
  {
    heading: string;
    switchPrompt: string;
    switchLabel: string;
    switchesTo: AuthMode;
    notConnected: string;
  }
> = {
  signUp: {
    heading: "Create Your Account",
    switchPrompt: "Already have an account?",
    switchLabel: "Log in",
    switchesTo: "signIn",
    notConnected: "Email sign-up isn't connected yet.",
  },
  signIn: {
    heading: "Welcome Back",
    switchPrompt: "Don't have an account?",
    switchLabel: "Sign up",
    switchesTo: "signUp",
    notConnected: "Email log in isn't connected yet.",
  },
};

type FormNotice = { tone: "info" | "error"; text: string };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getEmailError(email: string) {
  if (!email) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email, like name@example.com.";
  }
  return null;
}

export default function Auth() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<AuthMode>("signUp");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State updates land after the next render, too late to stop a double tap.
  const submitInFlight = useRef(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const emailHasFocus = useRef(false);
  const formOffset = useRef(0);
  const viewportHeight = useRef(0);

  const content = MODE_CONTENT[mode];

  const logoWidth = width * LOGO_SCREEN_WIDTH_RATIO;
  const logoHeight = logoWidth / LOGO_ASPECT_RATIO;
  const headingFontSize = clamp(width * 0.073, 26, 32);
  const headingLineHeight =
    headingFontSize * (typography.h1.lineHeight / typography.h1.fontSize);
  const taglineFontSize = clamp(width * 0.047, 16, 20);
  const taglineLineHeight = taglineFontSize * 1.4;

  // Sized from the window, not the viewport, so the keyboard cannot resize it.
  const headerHeight =
    logoHeight + spacing.md + headingLineHeight + spacing.xs + taglineLineHeight;
  const freeHeight =
    height -
    insets.top -
    Math.max(insets.bottom, spacing.base) -
    headerHeight -
    FORM_HEIGHT -
    FOOTER_HEIGHT -
    spacing.base -
    spacing.sm;
  const teamImageHeight = clamp(
    freeHeight,
    TEAM_IMAGE_MIN_HEIGHT,
    // Exactly the photo's height at full content width, so the fade meets its edge.
    (width - SCREEN_GUTTER * 2) / TEAM_IMAGE_ASPECT_RATIO,
  );
  const spareHeight = Math.max(freeHeight - teamImageHeight, 0);

  function revealForm() {
    scrollRef.current?.scrollTo({
      y: Math.max(formOffset.current - spacing.md, 0),
      animated: true,
    });
  }

  // The viewport only shrinks once the keyboard has taken its space, which is
  // the first moment the scroll view can actually reach the form.
  function handleViewportLayout(event: LayoutChangeEvent) {
    const nextHeight = event.nativeEvent.layout.height;
    const previousHeight = viewportHeight.current;
    viewportHeight.current = nextHeight;

    if (nextHeight < previousHeight && emailHasFocus.current) {
      revealForm();
    } else if (previousHeight > 0 && nextHeight > previousHeight) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setEmailError(null);
    setNotice(null);
  }

  function handleEmailFocus() {
    emailHasFocus.current = true;
    setIsEmailFocused(true);
  }

  function handleEmailBlur() {
    emailHasFocus.current = false;
    setIsEmailFocused(false);
  }

  function handleSwitchMode() {
    setMode(content.switchesTo);
    setEmailError(null);
    setNotice(null);
  }

  async function handleContinue() {
    if (submitInFlight.current) return;

    const trimmedEmail = email.trim();
    const validationError = getEmailError(trimmedEmail);
    setEmailError(validationError);
    setNotice(null);
    if (validationError) return;

    submitInFlight.current = true;
    setIsSubmitting(true);
    try {
      await continueWithEmail(mode, trimmedEmail);
    } catch (error) {
      if (error instanceof AuthNotConnectedError) {
        setNotice({ tone: "info", text: content.notConnected });
      } else {
        console.error("[auth] Email authentication failed:", error);
        setNotice({
          tone: "error",
          text: "We couldn't continue right now. Please try again.",
        });
      }
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  const message: FormNotice | null = emailError
    ? { tone: "error", text: emailError }
    : notice;

  let inputBorderColor = `${colors.brand.purple}66`;
  if (emailError) inputBorderColor = componentTokens.input.errorBorder;
  else if (isEmailFocused) inputBorderColor = componentTokens.input.focusedBorder;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Backdrop width={width} />

      {/* Padding also works when a window resize already moved the content. */}
      <KeyboardAvoidingView
        style={[styles.keyboardArea, { paddingTop: insets.top }]}
        behavior="padding"
      >
        <ScrollView
          ref={scrollRef}
          onLayout={handleViewportLayout}
          contentContainerStyle={[
            styles.content,
            {
              minHeight: height - insets.top,
              paddingTop: spacing.sm + spareHeight * 0.6,
              paddingBottom:
                Math.max(insets.bottom, spacing.base) + spareHeight * 0.4,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
        >
          <View style={styles.header}>
            {/* The tagline is part of this artwork, so it is not repeated as text. */}
            <Image
              source={require("../../assets/images/urlynk-splash-logo.png")}
              style={{ width: logoWidth, height: logoHeight }}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityRole="image"
              accessibilityLabel="UrLynk logo. Its Ur life. Its Ur style"
            />
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
              style={[
                styles.heading,
                { fontSize: headingFontSize, lineHeight: headingLineHeight },
              ]}
            >
              {content.heading}
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              style={[
                styles.tagline,
                { fontSize: taglineFontSize, lineHeight: taglineLineHeight },
              ]}
            >
              Your Team. Your Growth.
            </Text>
          </View>

          <View style={[styles.teamImageFrame, { height: teamImageHeight }]}>
            <Image
              source={require("../../assets/images/authentication-part.png")}
              style={styles.teamImage}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityRole="image"
              accessibilityLabel="A team of business professionals celebrating together"
            />
            <View style={styles.teamImageFade} />
          </View>

          <View
            style={styles.form}
            onLayout={(event) => {
              formOffset.current = event.nativeEvent.layout.y;
            }}
          >
            <View
              style={[styles.emailField, { borderColor: inputBorderColor }]}
            >
              <Image
                source={require("../../assets/images/auth-icon-mail.png")}
                style={styles.emailIcon}
                resizeMode="contain"
                fadeDuration={0}
              />
              <TextInput
                value={email}
                onChangeText={handleEmailChange}
                onFocus={handleEmailFocus}
                onBlur={handleEmailBlur}
                onSubmitEditing={handleContinue}
                editable={!isSubmitting}
                placeholder="Enter your email address"
                placeholderTextColor={componentTokens.input.placeholder}
                keyboardType="email-address"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="go"
                maxLength={254}
                maxFontSizeMultiplier={1.3}
                cursorColor={colors.interaction.primary}
                selectionColor={`${colors.brand.purple}66`}
                accessibilityLabel="Email address"
                style={styles.emailInput}
              />
            </View>

            <View style={styles.messageSlot}>
              {message ? <FormMessage notice={message} /> : null}
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Continue with Email"
              accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
              disabled={isSubmitting}
              onPress={handleContinue}
              style={[styles.primaryButton, isSubmitting && styles.busyButton]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.neutral.white} />
              ) : (
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryLabel}>
                  Continue with Email →
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.separator}>
              <View style={styles.separatorLine} />
              <Text maxFontSizeMultiplier={1.3} style={styles.separatorLabel}>
                or
              </Text>
              <View style={styles.separatorLine} />
            </View>

            <View style={styles.socialButtons}>
              <PendingSocialButton
                label="Continue with Google"
                icon={require("../../assets/images/auth-icon-google.png")}
              />
              <PendingSocialButton
                label="Continue with Facebook"
                icon={require("../../assets/images/auth-icon-facebook.png")}
              />
            </View>
          </View>

          <View style={styles.footer}>
            <Text maxFontSizeMultiplier={1.3} style={styles.switchPrompt}>
              {content.switchPrompt}
            </Text>
            <TouchableOpacity
              activeOpacity={0.6}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handleSwitchMode}
              hitSlop={spacing.md}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.switchLabel}>
                {content.switchLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FormMessage({ notice }: { notice: FormNotice }) {
  const palette = statusColors[notice.tone];

  return (
    <View style={styles.message} accessibilityLiveRegion="polite">
      <View style={[styles.messageIcon, { backgroundColor: palette.icon }]}>
        <Text allowFontScaling={false} style={styles.messageIconLabel}>
          {notice.tone === "error" ? "!" : "i"}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.messageText}>
        {notice.text}
      </Text>
    </View>
  );
}

/** Deliberately inert until Google and Facebook are connected through Clerk. */
function PendingSocialButton({
  label,
  icon,
}: {
  label: string;
  icon: ImageSourcePropType;
}) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}, not available yet`}
      accessibilityState={{ disabled: true }}
      style={styles.socialButton}
    >
      <Image
        source={icon}
        style={styles.socialIcon}
        resizeMode="contain"
        fadeDuration={0}
      />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={styles.socialLabel}
      >
        {label}
      </Text>
      <View style={styles.soonChip}>
        <Text allowFontScaling={false} style={styles.soonLabel}>
          Soon
        </Text>
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
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  waveBottom: {
    position: "absolute",
    bottom: 0,
  },
  keyboardArea: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: SCREEN_GUTTER,
  },
  header: {
    alignItems: "center",
    gap: spacing.xs,
  },
  heading: {
    marginTop: spacing.md - spacing.xs,
    fontFamily: typography.h1.fontFamily,
    color: colors.ui.textPrimary,
    textAlign: "center",
  },
  tagline: {
    fontFamily: fontFamily.regular,
    color: colors.ui.textSecondary,
    textAlign: "center",
  },
  teamImageFrame: {
    alignItems: "center",
  },
  teamImage: {
    width: "100%",
    height: "100%",
  },
  teamImageFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: TEAM_IMAGE_FADE_HEIGHT,
    backgroundImage: `linear-gradient(180deg, ${colors.ui.surface}00 0%, ${colors.ui.surface} 100%)`,
  },
  form: {
    marginTop: spacing.sm,
  },
  emailField: {
    height: componentTokens.input.height,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderRadius: radius.xl,
    backgroundColor: componentTokens.input.background,
  },
  emailIcon: {
    width: spacing.xl,
    height: spacing.xl,
    tintColor: colors.brand.indigo,
  },
  emailInput: {
    ...componentTokens.input.typography,
    flex: 1,
    height: "100%",
    paddingVertical: 0,
    color: colors.ui.textPrimary,
    includeFontPadding: false,
  },
  messageSlot: {
    minHeight: MESSAGE_SLOT_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  message: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
  },
  messageIcon: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  messageIconLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    lineHeight: 14,
    color: colors.neutral.white,
  },
  messageText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.ui.textPrimary,
  },
  primaryButton: {
    height: componentTokens.button.height,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brand.indigo,
    backgroundImage: `linear-gradient(90deg, ${gradients.bluePurple.start}, ${gradients.bluePurple.end})`,
    boxShadow: `0px 8px 20px ${colors.brand.indigo}47`,
  },
  busyButton: {
    opacity: 0.8,
  },
  primaryLabel: {
    ...componentTokens.button.typography,
    fontFamily: fontFamily.semiBold,
    color: colors.neutral.white,
  },
  separator: {
    height: SEPARATOR_HEIGHT,
    marginVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
  },
  separatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.ui.borderStrong,
  },
  separatorLabel: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
    includeFontPadding: false,
  },
  socialButtons: {
    gap: spacing.md,
  },
  socialButton: {
    height: componentTokens.button.height,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 64,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: colors.ui.border,
    backgroundColor: colors.ui.screen,
  },
  socialIcon: {
    position: "absolute",
    left: spacing.lg,
    width: spacing.xl,
    height: spacing.xl,
    opacity: 0.55,
  },
  socialLabel: {
    ...typography.inputLabel,
    color: colors.ui.textSecondary,
  },
  soonChip: {
    position: "absolute",
    right: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.interaction.primaryLight,
  },
  soonLabel: {
    ...typography.caption,
    fontFamily: fontFamily.medium,
    color: colors.interaction.primaryPressed,
  },
  footer: {
    minHeight: FOOTER_HEIGHT,
    marginTop: spacing.base,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: spacing.xs,
  },
  switchPrompt: {
    ...typography.bodyMedium,
    color: colors.ui.textSecondary,
  },
  switchLabel: {
    ...typography.bodyMedium,
    fontFamily: fontFamily.semiBold,
    color: colors.brand.indigo,
    textDecorationLine: "underline",
  },
});
