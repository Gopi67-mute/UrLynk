/**
 * Saving and restoring one account's query cache.
 *
 * TanStack Query hands over a `PersistedClient` — the whole dehydrated cache — and asks
 * for it back on the next launch. This wraps that exchange in two things it does not do
 * itself:
 *
 * - **An account envelope.** Every snapshot records which leader it belongs to, and a
 *   restore that does not match the signed-in leader returns nothing and deletes the
 *   file. `PersistQueryClientProvider` checks the cache's age and version; it has no
 *   concept of identity, and identity is the one thing this app cannot get wrong.
 * - **A throttle.** A single screen load settles dozens of queries in a few hundred
 *   milliseconds. Writing on each would serialize the entire cache dozens of times over;
 *   writing once, after things stop moving, costs one.
 *
 * The storage and the policy are both injected, so the whole lifecycle — restore,
 * reject, throttle, collapse, remove — runs under `node --test` against fakes, with no
 * SQLite and no device. `sqlite-cache.ts` supplies the real storage and
 * `cache-policy.ts` the real rules; `query/query-provider.tsx` is where the two are
 * joined. This file is the mechanism and holds no policy of its own, which is also why
 * it imports nothing at run time.
 */

import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/** The three operations a snapshot store has to support. */
export type SnapshotStorage = {
  read(accountId: string): Promise<string | null>;
  write(accountId: string, payload: string): Promise<void>;
  remove(accountId: string): Promise<void>;
};

/** Who a stored snapshot belongs to, and when it was written. */
export type SnapshotStamp = {
  accountId: string;
  version: string;
  savedAt: number;
};

/** What is actually written: the dehydrated cache, with who and when around it. */
type SnapshotEnvelope = SnapshotStamp & {
  client: PersistedClient;
};

export type SnapshotPersister = Persister & {
  /** Write any throttled snapshot now. Returns once it has been stored. */
  flush(): Promise<void>;
  /** Drop a throttled snapshot without writing it, and stop the timer. */
  cancel(): void;
};

export type PersisterOptions = {
  /** The signed-in leader. A snapshot is written and read under this and nothing else. */
  accountId: string;
  storage: SnapshotStorage;
  /** Stamped on what is written, and checked on what is read. */
  version: string;
  /** The app's rule for whether a stored snapshot may be shown. */
  isUsable: (stamp: SnapshotStamp, context: { accountId: string; now: number }) => boolean;
  /** How long a burst of cache changes is collapsed for before one write. */
  throttleMs: number;
  now?: () => number;
  /** Injected so the throttle can be driven by hand in a test. */
  schedule?: (callback: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
};

function isEnvelope(value: unknown): value is SnapshotEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SnapshotEnvelope>;
  return (
    typeof candidate.accountId === "string"
    && typeof candidate.version === "string"
    && typeof candidate.savedAt === "number"
    && typeof candidate.client === "object"
    && candidate.client !== null
  );
}

export function createSnapshotPersister(options: PersisterOptions): SnapshotPersister {
  const {
    accountId,
    storage,
    version,
    isUsable,
    throttleMs,
    now = Date.now,
    schedule = (callback, ms) => setTimeout(callback, ms),
    unschedule = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  /** The newest cache handed over but not yet written. */
  let pending: PersistedClient | null = null;
  let timer: unknown = null;
  /** Writes are chained, so two snapshots can never be stored out of order. */
  let writing: Promise<void> = Promise.resolve();

  function store(client: PersistedClient): Promise<void> {
    const envelope: SnapshotEnvelope = {
      accountId,
      version,
      savedAt: now(),
      client,
    };

    writing = writing
      .catch(() => undefined) // one failed write must not poison every later one
      .then(() => storage.write(accountId, JSON.stringify(envelope)));
    return writing;
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
    const client = pending;
    pending = null;
    if (client) await store(client);
    else await writing;
  }

  return {
    persistClient(client: PersistedClient): void {
      // Only the latest matters: an older snapshot of the same cache has nothing in it
      // that the newer one does not.
      pending = client;
      if (timer !== null) return;

      timer = schedule(() => {
        timer = null;
        const queued = pending;
        pending = null;
        if (queued) void store(queued);
      }, throttleMs);
    },

    async restoreClient(): Promise<PersistedClient | undefined> {
      const payload = await storage.read(accountId);
      if (payload === null) return undefined;

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Unreadable, so not worth keeping: the next write replaces it anyway, and
        // leaving it would mean parsing it again on every launch.
        await storage.remove(accountId);
        return undefined;
      }

      if (!isEnvelope(parsed)) {
        await storage.remove(accountId);
        return undefined;
      }

      // The identity check, and the reason this wrapper exists. A snapshot belonging to
      // anyone but the signed-in leader is deleted rather than returned — not skipped,
      // deleted, because there is no circumstance in which this device should keep it.
      if (!isUsable(parsed, { accountId, now: now() })) {
        await storage.remove(accountId);
        return undefined;
      }

      return parsed.client;
    },

    async removeClient(): Promise<void> {
      pending = null;
      if (timer !== null) {
        unschedule(timer);
        timer = null;
      }
      await storage.remove(accountId);
    },

    flush,

    cancel(): void {
      pending = null;
      if (timer !== null) {
        unschedule(timer);
        timer = null;
      }
    },
  };
}
