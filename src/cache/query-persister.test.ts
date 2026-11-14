import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CACHE_VERSION,
  isSnapshotUsable,
  MAX_CACHE_AGE_MS,
  PERSIST_THROTTLE_MS,
} from "./cache-policy.ts";
import { createSnapshotPersister, type SnapshotStorage } from "./query-persister.ts";

const ACCOUNT = "user_2abcDEF123";
const OTHER_ACCOUNT = "user_9zzzXYZ789";
const NOW = 1_770_000_000_000;

/** A snapshot store in memory, with a record of everything asked of it. */
function fakeStorage(seed: Record<string, string> = {}) {
  const rows = new Map<string, string>(Object.entries(seed));
  const writes: string[] = [];
  const removes: string[] = [];

  const storage: SnapshotStorage = {
    async read(accountId) {
      return rows.get(accountId) ?? null;
    },
    async write(accountId, payload) {
      rows.set(accountId, payload);
      writes.push(accountId);
    },
    async remove(accountId) {
      rows.delete(accountId);
      removes.push(accountId);
    },
  };

  return { storage, rows, writes, removes };
}

/** A clock and a timer the test drives, so no assertion waits on real time. */
function fakeScheduler() {
  let queued: (() => void) | null = null;
  return {
    schedule: (callback: () => void) => {
      queued = callback;
      return 1;
    },
    unschedule: () => {
      queued = null;
    },
    /** Fire the pending timer, if there is one. */
    run: () => {
      const callback = queued;
      queued = null;
      callback?.();
    },
    get armed() {
      return queued !== null;
    },
  };
}

function cacheWith(label: string) {
  return {
    timestamp: NOW,
    buster: CACHE_VERSION,
    clientState: { mutations: [], queries: [{ queryHash: label }] },
  } as never;
}

function envelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    accountId: ACCOUNT,
    version: CACHE_VERSION,
    savedAt: NOW - 1_000,
    client: cacheWith("team"),
    ...overrides,
  });
}

/**
 * A persister wired to the app's real policy — the same `CACHE_VERSION` and the same
 * `isSnapshotUsable` the provider passes in — so these tests exercise the rules the app
 * actually runs rather than a set invented for the test.
 */
function persisterWith(storage: SnapshotStorage, scheduler = fakeScheduler(), accountId = ACCOUNT) {
  return {
    scheduler,
    persister: createSnapshotPersister({
      accountId,
      storage,
      version: CACHE_VERSION,
      isUsable: isSnapshotUsable,
      throttleMs: PERSIST_THROTTLE_MS,
      now: () => NOW,
      schedule: scheduler.schedule,
      unschedule: scheduler.unschedule,
    }),
  };
}

test("a snapshot written for this leader is restored for this leader", async () => {
  const { storage } = fakeStorage({ [ACCOUNT]: envelope() });
  const { persister } = persisterWith(storage);

  const restored = await persister.restoreClient();

  assert.ok(restored);
  assert.equal(restored.clientState.queries[0].queryHash, "team");
});

// The reason this wrapper exists at all. Nothing else in the persistence stack knows
// what an account is.
test("another leader's snapshot is never restored, and is deleted rather than left", async () => {
  const { storage, rows, removes } = fakeStorage({
    [ACCOUNT]: envelope({ accountId: OTHER_ACCOUNT }),
  });
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [ACCOUNT]);
  assert.equal(rows.has(ACCOUNT), false);
});

test("a snapshot from an older cache version is discarded", async () => {
  const { storage, removes } = fakeStorage({ [ACCOUNT]: envelope({ version: "0" }) });
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [ACCOUNT]);
});

test("a snapshot past its age limit is discarded", async () => {
  const { storage, removes } = fakeStorage({
    [ACCOUNT]: envelope({ savedAt: NOW - MAX_CACHE_AGE_MS - 1 }),
  });
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [ACCOUNT]);
});

test("unreadable stored text is discarded rather than parsed again every launch", async () => {
  const { storage, removes } = fakeStorage({ [ACCOUNT]: "{not json" });
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [ACCOUNT]);
});

test("stored text that is valid JSON but not a snapshot is discarded", async () => {
  const { storage, removes } = fakeStorage({ [ACCOUNT]: JSON.stringify({ hello: "world" }) });
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [ACCOUNT]);
});

test("nothing cached is simply nothing cached", async () => {
  const { storage, removes } = fakeStorage();
  const { persister } = persisterWith(storage);

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removes, [], "an absent snapshot is not a snapshot to delete");
});

// One screen load settles dozens of queries. Writing on each would serialize the whole
// cache dozens of times; this is the whole point of the throttle.
test("a burst of cache changes costs one write, of the newest cache", async () => {
  const { storage, rows, writes } = fakeStorage();
  const { persister, scheduler } = persisterWith(storage);

  persister.persistClient(cacheWith("first"));
  persister.persistClient(cacheWith("second"));
  persister.persistClient(cacheWith("third"));

  assert.deepEqual(writes, [], "nothing is written until the timer fires");
  scheduler.run();
  await persister.flush();

  assert.deepEqual(writes, [ACCOUNT]);
  assert.equal(JSON.parse(rows.get(ACCOUNT)!).client.clientState.queries[0].queryHash, "third");
});

test("a written snapshot carries the account, the version and the time", async () => {
  const { storage, rows } = fakeStorage();
  const { persister } = persisterWith(storage);

  persister.persistClient(cacheWith("team"));
  await persister.flush();

  const written = JSON.parse(rows.get(ACCOUNT)!);
  assert.equal(written.accountId, ACCOUNT);
  assert.equal(written.version, CACHE_VERSION);
  assert.equal(written.savedAt, NOW);
});

test("what one persister writes, a persister for the same account reads back", async () => {
  const { storage } = fakeStorage();
  const { persister } = persisterWith(storage);

  persister.persistClient(cacheWith("round-trip"));
  await persister.flush();

  const { persister: reopened } = persisterWith(storage);
  const restored = await reopened.restoreClient();

  assert.equal(restored?.clientState.queries[0].queryHash, "round-trip");
});

test("what one leader writes, another leader's persister cannot read", async () => {
  const { storage } = fakeStorage();
  const { persister } = persisterWith(storage);

  persister.persistClient(cacheWith("private"));
  await persister.flush();

  const { persister: otherLeader } = persisterWith(storage, fakeScheduler(), OTHER_ACCOUNT);
  assert.equal(await otherLeader.restoreClient(), undefined);
});

test("removing the client drops the snapshot and any write still waiting", async () => {
  const { storage, rows, writes, removes } = fakeStorage({ [ACCOUNT]: envelope() });
  const { persister, scheduler } = persisterWith(storage);

  persister.persistClient(cacheWith("about to be dropped"));
  await persister.removeClient();

  assert.deepEqual(removes, [ACCOUNT]);
  assert.equal(rows.has(ACCOUNT), false);
  assert.equal(scheduler.armed, false, "the throttle timer is stopped");

  scheduler.run();
  await persister.flush();
  assert.deepEqual(writes, [], "a cancelled snapshot is never written after removal");
});

test("cancelling stops a pending write without touching what is stored", async () => {
  const { storage, rows, writes, removes } = fakeStorage({ [ACCOUNT]: envelope() });
  const { persister, scheduler } = persisterWith(storage);

  persister.persistClient(cacheWith("dropped"));
  persister.cancel();
  scheduler.run();
  await persister.flush();

  assert.deepEqual(writes, []);
  assert.deepEqual(removes, []);
  assert.ok(rows.has(ACCOUNT), "the snapshot already on disk is left alone");
});

test("a failed write does not stop the next one", async () => {
  const { storage, writes } = fakeStorage();
  let failNext = true;
  const flaky: SnapshotStorage = {
    ...storage,
    async write(accountId, payload) {
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      await storage.write(accountId, payload);
    },
  };
  const { persister } = persisterWith(flaky);

  persister.persistClient(cacheWith("first"));
  await persister.flush().catch(() => undefined);

  persister.persistClient(cacheWith("second"));
  await persister.flush();

  assert.deepEqual(writes, [ACCOUNT]);
});
