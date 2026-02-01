/**
 * PGlite database wrapper with vector support.
 */

import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {readFile, writeFile} from 'fs/promises';
import {SCHEMA} from './schema';

export interface TransactionScope {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export class PGliteDatabase {
  private constructor(private db: PGlite) {}

  /** Create a new in-memory database */
  static async create(): Promise<PGliteDatabase> {
    const db = await PGlite.create({
      extensions: {vector},
    });
    return new PGliteDatabase(db);
  }

  /** Load database from a file (gzipped tarball) */
  static async fromFile(path: string): Promise<PGliteDatabase> {
    const buffer = await readFile(path);
    const blob = new Blob([buffer]);

    const db = await PGlite.create({
      extensions: {vector},
      loadDataDir: blob,
    });

    return new PGliteDatabase(db);
  }

  /** Load database from a Blob */
  static async fromBlob(blob: Blob): Promise<PGliteDatabase> {
    const db = await PGlite.create({
      extensions: {vector},
      loadDataDir: blob,
    });
    return new PGliteDatabase(db);
  }

  /** Initialize schema (idempotent) */
  async initSchema(): Promise<void> {
    await this.db.exec(SCHEMA);
  }

  /** Execute a parameterized query */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }

  /** Execute raw SQL (no params, multiple statements OK) */
  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  /** Run a transaction */
  async transaction<T>(fn: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return this.db.transaction(async pgTx => {
      const scope: TransactionScope = {
        query: async <R>(sql: string, params?: unknown[]) => {
          const result = await pgTx.query<R>(sql, params);
          return result.rows;
        },
        exec: async (sql: string) => {
          await pgTx.exec(sql);
        },
      };
      return fn(scope);
    });
  }

  // Image Storage (BLOB support)

  /** Store an image in the database */
  async storeImage(
    id: string,
    data: ArrayBuffer,
    mimeType: string,
    articleId: string,
    originalUrl: string,
  ): Promise<void> {
    // Convert ArrayBuffer to base64 for storage
    const base64 = Buffer.from(data).toString('base64');

    await this.query(
      `INSERT INTO image (id, article_id, data, mime_type, original_url)
       VALUES ($1, $2, decode($3, 'base64'), $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         mime_type = EXCLUDED.mime_type`,
      [id, articleId, base64, mimeType, originalUrl],
    );
  }

  /** Retrieve an image from the database */
  async getImage(id: string): Promise<{data: Buffer; mimeType: string} | null> {
    const rows = await this.query<{data: Buffer; mime_type: string}>(
      'SELECT data, mime_type FROM image WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return {data: rows[0].data, mimeType: rows[0].mime_type};
  }

  // Export

  /** Dump database to a gzipped tarball */
  async dump(): Promise<Blob> {
    const file = await this.db.dumpDataDir('gzip');
    // dumpDataDir returns Blob | File, both have arrayBuffer()
    if (file instanceof Blob) {
      return file;
    }
    // File extends Blob, so this handles File case
    return new Blob([await (file as File).arrayBuffer()]);
  }

  /** Save dump to file */
  async dumpToFile(path: string): Promise<void> {
    const blob = await this.dump();
    const buffer = Buffer.from(await blob.arrayBuffer());
    await writeFile(path, buffer);
  }

  /** Close the database */
  async close(): Promise<void> {
    await this.db.close();
  }
}
