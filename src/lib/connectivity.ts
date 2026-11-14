/**
 * Whether the device can reach UrLynk, told to TanStack Query and to the screens.
 *
 * Without this, TanStack Query assumes it is always online: every request made with no
 * connection is attempted, fails, and arrives at a screen as an error. That is why the
 * app used to replace a dashboard with "We couldn't load your team numbers" when the
 * real answer was "you are on the Underground".
 *
 * With `onlineManager` told the truth, three things follow on their own:
 *
 * - a query with no connection is **paused** rather than failed, so cached data stays on
 *   screen and no error is invented for it;
 * - a mutation is paused too, which is why writes are refused outright while offline
 *   (see `useIsOnline` at the call sites) rather than left hanging;
 * - `refetchOnReconnect` starts working, so the connection coming back refreshes what is
 *   stale without the user doing anything.
 */

import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { isOnlineFrom } from "./network-state";
import { startupTrace } from "./startup-trace";

let installed = false;

/**
 * Begin watching the device's connectivity. Call once, as the app starts.
 *
 * Expo's listener reports changes; the first reading has to be asked for, which is the
 * one that matters on a cold start. If that first read fails the app assumes it is
 * online — the same bias as `isOnlineFrom`, and for the same reason: a failed request
 * corrects itself, while a wrongly offline app refuses to try at all.
 */
export function installConnectivityWatch(): void {
  if (installed) return;
  installed = true;

  onlineManager.setEventListener((setOnline) => {
    let stopped = false;

    const apply = (online: boolean) => {
      if (stopped) return;
      startupTrace.event(`network ${online ? "online" : "offline"}`);
      setOnline(online);
    };

    void Network.getNetworkStateAsync()
      .then((state) => apply(isOnlineFrom(state)))
      .catch(() => apply(true));

    const subscription = Network.addNetworkStateListener((state) => {
      apply(isOnlineFrom(state));
    });

    return () => {
      stopped = true;
      subscription.remove();
    };
  });
}

/**
 * Whether the device is online, as a value a screen can render from.
 *
 * Reads `onlineManager` rather than Expo directly, so the screens and the query cache
 * can never disagree about whether there is a connection: a screen saying "offline"
 * while queries are being fired, or the reverse, would be worse than either state.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  );
}
