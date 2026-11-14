/**
 * Reading a device's network state as a single question: can UrLynk reach its backend?
 *
 * Kept apart from the Expo module that reports it, so the judgement below can be tested
 * directly rather than inferred from a device. `connectivity.ts` does the subscribing.
 */

/** The parts of Expo's `NetworkState` this decision uses. */
export type NetworkReading = {
  /** Attached to something — Wi-Fi, mobile data, Ethernet. */
  isConnected?: boolean | null;
  /** Whether that something actually reaches the internet. Often unknown. */
  isInternetReachable?: boolean | null;
};

/**
 * Whether to treat the device as online.
 *
 * Two readings, and they are not the same thing: a phone can be firmly attached to a
 * café's Wi-Fi that leads nowhere. Where Android says so, `isInternetReachable` settles
 * it. Where it does not know — which is common, and is also what it reports while it is
 * still checking — being connected is taken as online.
 *
 * The bias is deliberate. Treating "unknown" as offline would make the app hide its
 * refresh behind an offline notice every time a network changed, and the cost of
 * guessing wrong the other way is small and self-correcting: the request fails, the
 * screen keeps its cached data and says the refresh did not work.
 */
export function isOnlineFrom(state: NetworkReading | null | undefined): boolean {
  if (!state) return false;
  if (state.isConnected !== true) return false;
  return state.isInternetReachable !== false;
}
