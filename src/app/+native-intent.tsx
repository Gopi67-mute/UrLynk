/**
 * The browser returns from Google or Facebook through this deep link. Clerk's
 * SSO flow consumes it, so the router must not treat it as a screen to open.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  if (!path.includes("sso-callback")) return path;
  return initial ? "/" : null;
}
