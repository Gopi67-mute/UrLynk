import {
  isClerkAPIResponseError,
  isClerkRuntimeError,
  useSignIn,
  useSignUp,
  useSSO,
} from "@clerk/expo";

export type AuthMode = "signUp" | "signIn";
export type SocialProvider = "google" | "facebook";

export type AuthFailure = { ok: false; message: string; isFieldError: boolean };
export type AuthResult = { ok: true } | AuthFailure;

const SUCCESS: AuthResult = { ok: true };

const SOCIAL_STRATEGIES = {
  google: "oauth_google",
  facebook: "oauth_facebook",
} as const;

const GENERIC_MESSAGE = "We couldn't continue right now. Please try again.";
const OFFLINE_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";

/** Messages for failures the user can fix from the field they just submitted. */
const FIELD_ERROR_MESSAGES: Record<string, string> = {
  form_identifier_not_found:
    "We couldn't find an account with this email. Sign up instead.",
  form_identifier_exists:
    "An account with this email already exists. Log in instead.",
  form_code_incorrect: "That code isn't correct. Check it and try again.",
  verification_expired: "That code has expired. Tap Resend code for a new one.",
  verification_failed:
    "Too many incorrect attempts. Tap Resend code for a new one.",
};

function failure(message: string, isFieldError = false): AuthFailure {
  return { ok: false, message, isFieldError };
}

/** Only error codes are logged, so emails and tokens never reach the logs. */
function toFailure(error: unknown): AuthFailure {
  if (isClerkAPIResponseError(error)) {
    const [firstError] = error.errors;
    const fieldMessage = firstError && FIELD_ERROR_MESSAGES[firstError.code];
    if (fieldMessage) return failure(fieldMessage, true);

    console.error("[auth] Clerk rejected the request:", firstError?.code);
    return failure(firstError?.longMessage ?? firstError?.message ?? GENERIC_MESSAGE);
  }

  if (isClerkRuntimeError(error) && error.code === "network_error") {
    return failure(OFFLINE_MESSAGE);
  }

  console.error(
    "[auth] Authentication failed:",
    error instanceof Error ? error.name : "unknown error",
  );
  return failure(GENERIC_MESSAGE);
}

function toResult({ error }: { error: unknown }): AuthResult {
  return error ? toFailure(error) : SUCCESS;
}

/** Clerk reports API failures as values but can still throw for anything else. */
async function attempt(task: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await task();
  } catch (error) {
    return toFailure(error);
  }
}

/** The single seam the auth screen uses to talk to Clerk. */
export function useAuthClient() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();

  function sendEmailCode(mode: AuthMode, emailAddress: string) {
    return attempt(async () => {
      if (mode === "signIn") {
        return toResult(await signIn.emailCode.sendCode({ emailAddress }));
      }

      const created = await signUp.create({ emailAddress });
      if (created.error) return toFailure(created.error);
      return toResult(await signUp.verifications.sendEmailCode());
    });
  }

  function resendEmailCode(mode: AuthMode) {
    return attempt(async () =>
      toResult(
        mode === "signIn"
          ? await signIn.emailCode.sendCode()
          : await signUp.verifications.sendEmailCode(),
      ),
    );
  }

  /**
   * Finishing here activates the session. The root layout's route guards react
   * to that and move the user to the home route, so no navigation happens here.
   */
  function verifyEmailCode(mode: AuthMode, code: string) {
    return attempt(async () => {
      if (mode === "signIn") {
        const verified = await signIn.emailCode.verifyCode({ code });
        if (verified.error) return toFailure(verified.error);
        if (signIn.status !== "complete") {
          console.error("[auth] Sign-in stopped at status:", signIn.status);
          return failure(GENERIC_MESSAGE);
        }
        return toResult(await signIn.finalize());
      }

      const verified = await signUp.verifications.verifyEmailCode({ code });
      if (verified.error) return toFailure(verified.error);
      if (signUp.status !== "complete") {
        console.error("[auth] Sign-up stopped at status:", signUp.status);
        return failure(GENERIC_MESSAGE);
      }
      return toResult(await signUp.finalize());
    });
  }

  function cancelEmailAttempt(mode: AuthMode) {
    return attempt(async () =>
      toResult(mode === "signIn" ? await signIn.reset() : await signUp.reset()),
    );
  }

  /** Closing the browser is not a failure, so it resolves as a quiet success. */
  function continueWithSocial(provider: SocialProvider) {
    return attempt(async () => {
      const { createdSessionId, setActive, authSessionResult } =
        await startSSOFlow({ strategy: SOCIAL_STRATEGIES[provider] });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        return SUCCESS;
      }

      if (authSessionResult?.type === "success") {
        console.error("[auth] Social sign-in ended without a session.");
        return failure(GENERIC_MESSAGE);
      }
      return SUCCESS;
    });
  }

  return {
    sendEmailCode,
    resendEmailCode,
    verifyEmailCode,
    cancelEmailAttempt,
    continueWithSocial,
  };
}
