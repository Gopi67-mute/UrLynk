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
  type AuthFailure,
  type AuthMode,
  type SocialProvider,
  useAuthClient,
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
const CODE_LENGTH = 6;

const MODE_CONTENT: Record<
  AuthMode,
  {
    heading: string;
    switchPrompt: string;
    switchLabel: string;
    switchesTo: AuthMode;
  }
> = {
  signUp: {
    heading: "Create Your Account",
    switchPrompt: "Already have an account?",
    switchLabel: "Log in",
    switchesTo: "signIn",
  },
  signIn: {
    heading: "Welcome Back",
    switchPrompt: "Don't have an account?",
    switchLabel: "Sign up",
    switchesTo: "signUp",
  },
};

type FormNotice = { tone: "info" | "error"; text: string };
type AuthStep = "email" | "code";
type PendingAction = "submit" | "resend" | SocialProvider;

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

function getCodeError(code: string) {
  if (code.length !== CODE_LENGTH) {
    return `Enter the ${CODE_LENGTH}-digit code from your email.`;
  }
  return null;
}

export default function Auth() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const authClient = useAuthClient();

  const [mode, setMode] = useState<AuthMode>("signUp");
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [isFieldFocused, setIsFieldFocused] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // State updates land after the next render, too late to stop a double tap.
  const actionInFlight = useRef(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const fieldHasFocus = useRef(false);
  const formOffset = useRef(0);
  const viewportHeight = useRef(0);

  const content = MODE_CONTENT[mode];
  const isCodeStep = step === "code";
  const isBusy = pendingAction !== null;
  const isSubmitting = pendingAction === "submit";
  const primaryLabel = isCodeStep ? "Verify" : "Continue with Email";

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

    if (nextHeight < previousHeight && fieldHasFocus.current) {
      revealForm();
    } else if (previousHeight > 0 && nextHeight > previousHeight) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function handleFieldChange(value: string) {
    setFieldError(null);
    if (isCodeStep) {
      setCode(value.replace(/\D/g, ""));
      return;
    }
    setEmail(value);
    setNotice(null);
  }

  function handleFieldFocus() {
    fieldHasFocus.current = true;
    setIsFieldFocused(true);
  }

  function handleFieldBlur() {
    fieldHasFocus.current = false;
    setIsFieldFocused(false);
  }

  function handleSwitchMode() {
    setMode(content.switchesTo);
    setFieldError(null);
    setNotice(null);
  }

  function showFailure(result: AuthFailure) {
    if (result.isFieldError) setFieldError(result.message);
    else setNotice({ tone: "error", text: result.message });
  }

  async function runAction(action: PendingAction, task: () => Promise<void>) {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    setPendingAction(action);
    try {
      await task();
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  }

  async function submitEmail() {
    const trimmedEmail = email.trim();
    const validationError = getEmailError(trimmedEmail);
    setFieldError(validationError);
    setNotice(null);
    if (validationError) return;

    await runAction("submit", async () => {
      const result = await authClient.sendEmailCode(mode, trimmedEmail);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      setCode("");
      setStep("code");
      setNotice({ tone: "info", text: `We sent a code to ${trimmedEmail}.` });
    });
  }

  async function submitCode() {
    const validationError = getCodeError(code);
    setFieldError(validationError);
    if (validationError) return;

    await runAction("submit", async () => {
      const result = await authClient.verifyEmailCode(mode, code);
      if (!result.ok) showFailure(result);
    });
  }

  function handleContinue() {
    return isCodeStep ? submitCode() : submitEmail();
  }

  async function handleResendCode() {
    await runAction("resend", async () => {
      setFieldError(null);
      const result = await authClient.resendEmailCode(mode);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      setCode("");
      setNotice({
        tone: "info",
        text: `We sent a new code to ${email.trim()}.`,
      });
    });
  }

  function showEmailStep() {
    fieldHasFocus.current = false;
    setIsFieldFocused(false);
    setStep("email");
    setCode("");
    setFieldError(null);
    setNotice(null);
  }

  function handleChangeEmail() {
    if (actionInFlight.current) return;

    showEmailStep();
    void authClient.cancelEmailAttempt(mode);
  }

  async function handleSocial(provider: SocialProvider) {
    await runAction(provider, async () => {
      // A social attempt replaces any email attempt still waiting for a code.
      showEmailStep();
      const result = await authClient.continueWithSocial(provider);
      if (!result.ok) showFailure(result);
    });
  }

  const message: FormNotice | null = fieldError
    ? { tone: "error", text: fieldError }
    : notice;

  let inputBorderColor = `${colors.brand.purple}66`;
  if (fieldError) inputBorderColor = componentTokens.input.errorBorder;
  else if (isFieldFocused) inputBorderColor = componentTokens.input.focusedBorder;

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
              {/* Remounted per step, as Android ignores keyboard changes on a live field. */}
              <TextInput
                key={step}
                value={isCodeStep ? code : email}
                onChangeText={handleFieldChange}
                onFocus={handleFieldFocus}
                onBlur={handleFieldBlur}
                onSubmitEditing={handleContinue}
                editable={!isBusy}
                autoFocus={isCodeStep}
                placeholder={
                  isCodeStep
                    ? `Enter ${CODE_LENGTH}-digit code`
                    : "Enter your email address"
                }
                placeholderTextColor={componentTokens.input.placeholder}
                keyboardType={isCodeStep ? "number-pad" : "email-address"}
                inputMode={isCodeStep ? "numeric" : "email"}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={isCodeStep ? "one-time-code" : "email"}
                textContentType={isCodeStep ? "oneTimeCode" : "emailAddress"}
                returnKeyType="go"
                maxLength={isCodeStep ? CODE_LENGTH : 254}
                maxFontSizeMultiplier={1.3}
                cursorColor={colors.interaction.primary}
                selectionColor={`${colors.brand.purple}66`}
                accessibilityLabel={
                  isCodeStep ? "Verification code" : "Email address"
                }
                style={styles.emailInput}
              />
            </View>

            <View style={styles.messageSlot}>
              {message ? <FormMessage notice={message} /> : null}
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
              accessibilityState={{ busy: isSubmitting, disabled: isBusy }}
              disabled={isBusy}
              onPress={handleContinue}
              style={[styles.primaryButton, isSubmitting && styles.busyButton]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.neutral.white} />
              ) : (
                <Text maxFontSizeMultiplier={1.3} style={styles.primaryLabel}>
                  {primaryLabel} →
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
              <SocialButton
                label="Continue with Google"
                icon={require("../../assets/images/auth-icon-google.png")}
                disabled={isBusy}
                isLoading={pendingAction === "google"}
                onPress={() => handleSocial("google")}
              />
              <SocialButton
                label="Continue with Facebook"
                icon={require("../../assets/images/auth-icon-facebook.png")}
                disabled={isBusy}
                isLoading={pendingAction === "facebook"}
                onPress={() => handleSocial("facebook")}
              />
            </View>

            {/* Clerk's bot protection attaches here during sign-up. */}
            <View nativeID="clerk-captcha" />
          </View>

          <View style={styles.footer}>
            {isCodeStep ? (
              <>
                <FooterLink
                  label={pendingAction === "resend" ? "Sending…" : "Resend code"}
                  disabled={isBusy}
                  onPress={handleResendCode}
                />
                <Text maxFontSizeMultiplier={1.3} style={styles.switchPrompt}>
                  ·
                </Text>
                <FooterLink
                  label="Change email"
                  disabled={isBusy}
                  onPress={handleChangeEmail}
                />
              </>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.3} style={styles.switchPrompt}>
                  {content.switchPrompt}
                </Text>
                <FooterLink
                  label={content.switchLabel}
                  disabled={isBusy}
                  onPress={handleSwitchMode}
                />
              </>
            )}
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

function FooterLink({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.md}
    >
      <Text maxFontSizeMultiplier={1.3} style={styles.switchLabel}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SocialButton({
  label,
  icon,
  disabled,
  isLoading,
  onPress,
}: {
  label: string;
  icon: ImageSourcePropType;
  disabled: boolean;
  isLoading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: isLoading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.socialButton}
    >
      {isLoading ? (
        <ActivityIndicator style={styles.socialIcon} color={colors.brand.indigo} />
      ) : (
        <Image
          source={icon}
          style={styles.socialIcon}
          resizeMode="contain"
          fadeDuration={0}
        />
      )}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={styles.socialLabel}
      >
        {label}
      </Text>
    </TouchableOpacity>
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
  },
  socialLabel: {
    ...typography.inputLabel,
    color: colors.ui.textPrimary,
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
