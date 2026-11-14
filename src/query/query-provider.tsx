import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useAuth } from "@clerk/expo";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CACHE_VERSION,
  isSnapshotUsable,
  MAX_CACHE_AGE_MS,
  PERSIST_THROTTLE_MS,
  shouldPersistQuery,
} from "@/cache/cache-policy";
import { createSnapshotPersister } from "@/cache/query-persister";
import {
  deleteEverything,
  deleteOtherAccounts,
  deleteSnapshot,
  readSnapshot,
  writeSnapshot,
} from "@/cache/sqlite-cache";
import { startupTrace } from "@/lib/startup-trace";
import { createQueryClient } from "./query-client";

/**
 * Server state for the signed-in leader, in memory and on the device.
 *
 * Two rules shape everything here, and the second one is why this file is not simply a
 * `QueryClientProvider`:
 *
 * **One account's data, and only while that account is signed in.** The whole provider
 * is keyed by the account, so a sign-in, a sign-out or a switch replaces it outright:
 * a brand-new `QueryClient` with nothing in it, a persister pointed at a different
 * snapshot, and the previous client discarded with everything it held. That is stronger
 * than emptying a shared client, which is what this used to do — an empty client is a
 * client that *was* holding someone else's numbers a moment ago, and the gap between
 * the two is a render.
 *
 * **Nothing cached is shown before the account is known.** While Clerk is still
 * settling there is no account, so there is no persister and nothing is restored; the
 * app renders its shell against an empty cache. Restoring first and checking afterwards
 * would mean a window — however short — in which one leader's dashboard could be drawn
 * for another.
 *
 * On top of that, every launch deletes every other account's rows, so the rule "at most
 * one leader's data is at rest on this device" holds even for the paths no sign-out ever
 * ran through: a session ended on another device, or an account switched while the app
 * was closed.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  // Only a *confirmed* identity counts. `userId` is undefined while Clerk is loading,
  // and reading that as "no account" is correct: it is not yet this leader's app.
  const accountId = isLoaded ? (userId ?? null) : null;

  useEffect(() => {
    if (!isLoaded) return;

    if (accountId) {
      void deleteOtherAccounts(accountId);
    } else {
      // Signed out. The cache is a convenience, not a record: there is no reason for a
      // signed-out device to keep a leader's team on it, and the next sign-in pays one
      // cold start for that.
      void deleteEverything();
    }
  }, [isLoaded, accountId]);

  return (
    <AccountCache key={accountId ?? "signed-out"} accountId={accountId}>
      {children}
    </AccountCache>
  );
}

/**
 * The cache for exactly one identity — or for none, before Clerk has answered.
 *
 * Remounted whenever that identity changes, which is what makes the client, its
 * contents and its persister replaced together rather than reset in place.
 */
function AccountCache({
  accountId,
  children,
}: {
  accountId: string | null;
  children: ReactNode;
}) {
  const [queryClient] = useState(createQueryClient);

  const persistOptions = useMemo(() => {
    if (!accountId) return null;

    return {
      persister: createSnapshotPersister({
        accountId,
        storage: {
          read: readSnapshot,
          write: writeSnapshot,
          remove: deleteSnapshot,
        },
        version: CACHE_VERSION,
        isUsable: isSnapshotUsable,
        throttleMs: PERSIST_THROTTLE_MS,
      }),
      // Checked by the provider as well as by the persister. The persister owns the one
      // check the provider cannot make — whose data this is.
      buster: CACHE_VERSION,
      maxAge: MAX_CACHE_AGE_MS,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
          shouldPersistQuery(
            { queryKey: query.queryKey, status: query.state.status },
            accountId,
          ),
      },
    };
  }, [accountId]);

  if (!persistOptions) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => startupTrace.mark("cache:restored")}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
