/**
 * What a failed request means to the person looking at the screen.
 *
 * The API client already says *what* went wrong (`ApiError.kind`). This decides what to
 * do about it, which is a different question and the one the UI actually needs:
 *
 * - a dropped connection is worth another attempt, and says so;
 * - an ended session is not: another attempt sends the same dead token. Signing in again
 *   is the fix, and the app routes there on its own once Clerk agrees the session is
 *   over, so offering "Try again" here would only look broken;
 * - a request the server *rejected* — 400 or 422 — is not a connectivity problem and
 *   never becomes one by waiting. Repeating it byte for byte gets the same refusal, so
 *   it is reported as a problem with the request rather than with the network.
 *
 * Takes the kind rather than the error, and imports nothing at run time, so the wording
 * and the retry decision are plain data the unit tests can run directly. `null` is for a
 * failure that is not an API error at all.
 */

import type { ApiErrorKind } from "@/api/client";

export type FailureKind =
  /** The request never reached the server, or it took too long. */
  | "offline"
  /** The session has ended or does not allow this. Signing in again is the fix. */
  | "session"
  /** The server understood the request and refused it. Retrying changes nothing. */
  | "rejected"
  /** The server failed or is temporarily down. Worth another attempt. */
  | "server"
  /** The app itself is not configured to reach the API. */
  | "config"
  /** No classification was possible. */
  | "unknown";

export type Failure = {
  kind: FailureKind;
  /** The headline, in the user's terms. */
  title: string;
  /** One sentence on what to do about it. */
  message: string;
  /** True when another attempt could plausibly succeed. */
  canRetry: boolean;
};

const OFFLINE_TITLE = "You appear to be offline";

/**
 * Describe a failure for display.
 *
 * `fallbackTitle` is the calling screen's own headline ("We couldn't load your team
 * numbers"), used for the cases where the screen knows better than this function what
 * the user was trying to do. The specific cases override it, because "we couldn't load
 * your team numbers" is a poor way to say that a session has expired.
 */
export function describeFailure(kind: ApiErrorKind | null, fallbackTitle: string): Failure {
  if (kind === null) {
    return {
      kind: "unknown",
      title: fallbackTitle,
      message: "Something went wrong. Please try again.",
      canRetry: true,
    };
  }

  switch (kind) {
    case "network":
      return {
        kind: "offline",
        title: OFFLINE_TITLE,
        message: "We couldn't reach UrLynk. Check your connection and try again.",
        canRetry: true,
      };
    case "timeout":
      return {
        kind: "offline",
        title: OFFLINE_TITLE,
        message: "The server took too long to respond. Please try again.",
        canRetry: true,
      };
    case "unauthorized":
      return {
        kind: "session",
        title: "Your session has ended",
        message: "Please sign in again to see your team.",
        canRetry: false,
      };
    case "forbidden":
      return {
        kind: "session",
        title: "You don't have access to this",
        message: "This belongs to another account. Sign in with that account to see it.",
        canRetry: false,
      };
    case "validation":
      return {
        kind: "rejected",
        title: "That request wasn't accepted",
        message: "Some of the details aren't valid. Check them and try again.",
        canRetry: false,
      };
    case "not_found":
      return {
        kind: "rejected",
        title: "We couldn't find this",
        message: "It may have been deleted. Go back and refresh to see what's there now.",
        canRetry: false,
      };
    case "conflict":
      return {
        kind: "rejected",
        title: "This changed in the meantime",
        message: "Refresh to see the current details, then try again.",
        canRetry: true,
      };
    case "unavailable":
      return {
        kind: "server",
        title: "UrLynk is temporarily unavailable",
        message: "The service is down for a moment. Please try again shortly.",
        canRetry: true,
      };
    case "server":
      return {
        kind: "server",
        title: fallbackTitle,
        message: "Something went wrong on our side. Please try again.",
        canRetry: true,
      };
    case "config":
      return {
        kind: "config",
        title: "The app can't reach the server",
        message: "Its connection settings are missing or wrong. Please report this.",
        canRetry: false,
      };
    case "http":
      return {
        kind: "unknown",
        title: fallbackTitle,
        message: "We couldn't complete that request. Please try again.",
        canRetry: true,
      };
  }
}
