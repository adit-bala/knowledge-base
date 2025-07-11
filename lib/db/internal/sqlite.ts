import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const SQLITE_DB_PATH = path.join(process.cwd(), 'db', 'notion.db');

export function ensureDbDir() {
  const dbDir = path.dirname(SQLITE_DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {recursive: true});
  }
}

export function sqliteDbExists(): boolean {
  return fs.existsSync(SQLITE_DB_PATH);
}

export function getSqliteConnection(): Database.Database {
  ensureDbDir();
  return new Database(SQLITE_DB_PATH);
}

export function sqliteTableExists(tableName: string): boolean {
  if (!sqliteDbExists()) return false;
  const db = getSqliteConnection();
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  db.close();
  return !!result;
}

export async function withSqliteConnection<T>(
  operation: (db: Database.Database) => Promise<T>,
): Promise<T> {
  const db = getSqliteConnection();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}
