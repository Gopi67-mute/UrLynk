/**
 * The local read cache: one SQLite database on the device.
 *
 * AGENTS.md §5.2 is the shape of this file. PostgreSQL is the permanent source of truth
 * and nothing here is ever written back to it; this is a copy of what the backend last
 * said, kept so that opening the app shows something immediately instead of a spinner.
 * There are no mutations, no queue and no write path — V1 does not have offline writes,
 * and this is not the place they would live if it did.
 *
 * Two tables, because the two things have genuinely different shapes:
 *
 * - **`query_snapshots`** holds one serialized TanStack Query cache per account. One row,
 *   rewritten whole, because that is what the persister hands over.
 * - **`member_photos`** holds images, addressed individually. They are deliberately kept
 *   out of the snapshot (see `cache-policy.ts`): re-serializing most of a megabyte every
 *   time any query changed would cost more than the requests it saves, and a photo keyed
 *   by its version never needs rewriting at all.
 *
 * **Every function here fails soft.** A cache is an optimization, and a device whose
 * storage is full or whose database file is corrupt must still be able to use UrLynk over
 * the network. A read that fails returns "nothing cached", a write that fails is logged
 * and dropped. Nothing here ever reports a success it did not have, and nothing here is
 * ever the only copy of anything.
 */

import * as SQLite from "expo-sqlite";
import type { MemberPhoto } from "@/api/members";
import { MAX_CACHED_PHOTOS, snapshotIdFor } from "./cache-policy";

const DATABASE_NAME = "urlynk-cache.db";

/**
 * The open database, opened once per app launch.
 *
 * A rejected promise is not cached: a failed open on a device that was momentarily out
 * of storage should not disable the cache for the rest of the session.
 */
let connection: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS query_snapshots (
    snapshot_id TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT NOT NULL,
    saved_at    INTEGER NOT NULL,
    payload     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS member_photos (
    account_id   TEXT NOT NULL,
    member_id    TEXT NOT NULL,
    version      TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data_uri     TEXT NOT NULL,
    saved_at     INTEGER NOT NULL,
    PRIMARY KEY (account_id, member_id, version)
  );

  CREATE INDEX IF NOT EXISTS ix_member_photos_account_saved
    ON member_photos (account_id, saved_at);
`;

function openCache(): Promise<SQLite.SQLiteDatabase> {
  connection ??= SQLite.openDatabaseAsync(DATABASE_NAME)
    .then(async (database) => {
      await database.execAsync(SCHEMA);
      return database;
    })
    .catch((error: unknown) => {
      connection = null; // let the next caller try again
      throw error;
    });
  return connection;
}

/** The reason a cache operation failed, without the detail that might name a person. */
function warn(operation: string, error: unknown): void {
  console.warn(
    `[cache] ${operation} failed:`,
    error instanceof Error ? error.message : "unknown error",
  );
}

/** The serialized query cache for this account, or null when there is none to read. */
export async function readSnapshot(accountId: string): Promise<string | null> {
  try {
    const database = await openCache();
    const row = await database.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM query_snapshots WHERE snapshot_id = ?",
      snapshotIdFor(accountId),
    );
    return row?.payload ?? null;
  } catch (error) {
    warn("reading the cached dashboard", error);
    return null;
  }
}

/**
 * Replace this account's snapshot.
 *
 * `INSERT OR REPLACE` on the account's own key: there is exactly one row per account and
 * it is rewritten whole, so a half-written snapshot cannot be left behind for the next
 * launch to restore.
 */
export async function writeSnapshot(accountId: string, payload: string): Promise<void> {
  try {
    const database = await openCache();
    await database.runAsync(
      "INSERT OR REPLACE INTO query_snapshots (snapshot_id, account_id, saved_at, payload)"
        + " VALUES (?, ?, ?, ?)",
      snapshotIdFor(accountId),
      accountId,
      Date.now(),
      payload,
    );
  } catch (error) {
    warn("saving the dashboard for offline use", error);
  }
}

/** Forget this account's snapshot, leaving its photos alone. */
export async function deleteSnapshot(accountId: string): Promise<void> {
  try {
    const database = await openCache();
    await database.runAsync("DELETE FROM query_snapshots WHERE account_id = ?", accountId);
  } catch (error) {
    warn("clearing the cached dashboard", error);
  }
}

/**
 * Remove every trace of every account except this one.
 *
 * Called once as soon as the signed-in account is known, which is what makes the rule
 * "at most one leader's data is ever at rest on this device, and it is the one signed
 * in" true in every case — including the ones no sign-out ever ran through, such as a
 * session ended on another device, an app reinstalled over itself, or a leader who
 * switched accounts while the app was not running.
 */
export async function deleteOtherAccounts(accountId: string): Promise<void> {
  try {
    const database = await openCache();
    await database.withTransactionAsync(async () => {
      await database.runAsync("DELETE FROM query_snapshots WHERE account_id != ?", accountId);
      await database.runAsync("DELETE FROM member_photos WHERE account_id != ?", accountId);
    });
  } catch (error) {
    warn("clearing another account's cached data", error);
  }
}

/** Empty the cache completely. This is what signing out does. */
export async function deleteEverything(): Promise<void> {
  try {
    const database = await openCache();
    await database.withTransactionAsync(async () => {
      await database.runAsync("DELETE FROM query_snapshots");
      await database.runAsync("DELETE FROM member_photos");
    });
  } catch (error) {
    warn("clearing the local cache", error);
  }
}

/**
 * A member's photo as it was last downloaded, for this exact version.
 *
 * The version is the member's `photo_updated_at`, so a hit is the current photo by
 * definition and a changed photo simply misses. That is what makes it safe to return
 * this without asking the server: there is no staleness to reason about.
 */
export async function readCachedPhoto(
  accountId: string,
  memberId: string,
  version: string,
): Promise<MemberPhoto | null> {
  try {
    const database = await openCache();
    const row = await database.getFirstAsync<{
      content_type: string;
      data_uri: string;
    }>(
      "SELECT content_type, data_uri FROM member_photos"
        + " WHERE account_id = ? AND member_id = ? AND version = ?",
      accountId,
      memberId,
      version,
    );
    if (!row) return null;

    return {
      member_id: memberId,
      content_type: row.content_type,
      updated_at: version,
      data_uri: row.data_uri,
    };
  } catch (error) {
    warn("reading a cached photo", error);
    return null;
  }
}

/**
 * Keep a downloaded photo for next time.
 *
 * Writing a new version drops the member's older ones in the same transaction — the app
 * only ever asks for the current version, so an old one is dead weight the moment a new
 * one arrives. The account's collection is then trimmed to `MAX_CACHED_PHOTOS`, oldest
 * first, so a leader who scrolls through a thousand members does not fill their phone.
 */
export async function writeCachedPhoto(accountId: string, photo: MemberPhoto): Promise<void> {
  try {
    const database = await openCache();
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        "DELETE FROM member_photos WHERE account_id = ? AND member_id = ? AND version != ?",
        accountId,
        photo.member_id,
        photo.updated_at,
      );
      await database.runAsync(
        "INSERT OR REPLACE INTO member_photos"
          + " (account_id, member_id, version, content_type, data_uri, saved_at)"
          + " VALUES (?, ?, ?, ?, ?, ?)",
        accountId,
        photo.member_id,
        photo.updated_at,
        photo.content_type,
        photo.data_uri,
        Date.now(),
      );
      await database.runAsync(
        "DELETE FROM member_photos WHERE account_id = ? AND rowid NOT IN ("
          + " SELECT rowid FROM member_photos WHERE account_id = ?"
          + " ORDER BY saved_at DESC LIMIT ?)",
        accountId,
        accountId,
        MAX_CACHED_PHOTOS,
      );
    });
  } catch (error) {
    warn("saving a photo for offline use", error);
  }
}

/** Drop every cached photo of one member. Used when their photo is changed or removed. */
export async function deleteCachedPhotos(accountId: string, memberId: string): Promise<void> {
  try {
    const database = await openCache();
    await database.runAsync(
      "DELETE FROM member_photos WHERE account_id = ? AND member_id = ?",
      accountId,
      memberId,
    );
  } catch (error) {
    warn("clearing a cached photo", error);
  }
}
