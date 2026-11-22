/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SQLITE_CORRUPT_ERRCODES = new Set([11, 26]); // SQLITE_CORRUPT, SQLITE_NOTADB

export function isSqliteCorruptionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { errcode?: unknown; message?: unknown; errstr?: unknown };
  if (typeof e.errcode === 'number' && SQLITE_CORRUPT_ERRCODES.has(e.errcode)) {
    return true;
  }
  const combined = `${String(e.message ?? '')} ${String(e.errstr ?? '')}`.toLowerCase();
  return (
    combined.includes('database disk image is malformed') ||
    combined.includes('file is not a database') ||
    combined.includes('malformed') ||
    combined.includes('sqlite_corrupt') ||
    combined.includes('sqlite_notadb')
  );
}

export function removeSqliteFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const filePath = `${dbPath}${suffix}`;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (unlinkErr) {
      console.warn(`[Roomwise SQLite] Unable to remove ${filePath}:`, unlinkErr);
    }
  }
}

function configureDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
}

function verifyQuickCheck(db: DatabaseSync): void {
  const rows = db.prepare('PRAGMA quick_check;').all() as Array<Record<string, unknown>>;
  const firstVal = rows[0] ? String(Object.values(rows[0])[0] ?? '') : '';
  if (firstVal.toLowerCase() !== 'ok') {
    throw new Error(`database disk image is malformed (quick_check: ${firstVal || 'failed'})`);
  }
}

/**
 * Opens a SQLite database with WAL + busy_timeout and runs PRAGMA quick_check.
 * If the on-disk database or WAL/SHM sidecar was corrupted by an abrupt container
 * restart or snapshot restore, removes the corrupt files and reopens cleanly.
 */
export function openResilientDatabase(dbPath: string, label: string): DatabaseSync {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath);
    configureDatabase(db);
    verifyQuickCheck(db);
    return db;
  } catch (err) {
    if (!isSqliteCorruptionError(err)) {
      throw err;
    }
    console.warn(
      `[Roomwise SQLite] Detected corrupted ${label} database at ${dbPath}. Recreating cleanly...`,
      err instanceof Error ? err.message : err
    );
    try {
      db?.close();
    } catch {
      // Ignore close error on already-corrupt handle
    }
    removeSqliteFiles(dbPath);
    const fresh = new DatabaseSync(dbPath);
    configureDatabase(fresh);
    return fresh;
  }
}

export function resetAndReopenDatabase(
  currentDb: DatabaseSync | null,
  dbPath: string,
  label: string
): DatabaseSync {
  console.warn(`[Roomwise SQLite] Resetting and reopening ${label} database at ${dbPath}...`);
  try {
    currentDb?.close();
  } catch {
    // Ignore close error
  }
  removeSqliteFiles(dbPath);
  const fresh = new DatabaseSync(dbPath);
  configureDatabase(fresh);
  return fresh;
}
