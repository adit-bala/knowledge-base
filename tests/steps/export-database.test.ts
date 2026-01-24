/**
 * Unit tests for ExportDatabaseStep.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, unlinkSync} from 'fs';
import {ExportDatabaseStep} from '../../lib/pipeline/steps/export-database';
import {PGliteDatabase} from '../../lib/db/pglite';
import {MockLogger} from '../mocks/logger';
import type {StepContext} from '../../lib/pipeline/step';
import type {ExportConfig} from '../../lib/pipeline/config';

describe('ExportDatabaseStep', () => {
  let step: ExportDatabaseStep;
  let db: PGliteDatabase;
  let logger: MockLogger;
  let ctx: StepContext<ExportConfig>;
  const testOutputPath = './test-export.db.tar.gz';

  beforeEach(async () => {
    step = new ExportDatabaseStep();
    db = await PGliteDatabase.create();
    await db.initSchema();
    logger = new MockLogger();
    ctx = {
      config: {export: {outputPath: testOutputPath}},
      logger,
      db,
    };

    // Insert some test data
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'article-1',
        'Test',
        'Test',
        [],
        new Date(),
        'content',
        'published',
        new Date(),
      ],
    );
  });

  afterEach(async () => {
    await db.close();
    // Clean up test file
    if (existsSync(testOutputPath)) {
      unlinkSync(testOutputPath);
    }
  });

  it('should export database to file', async () => {
    const result = await step.run(undefined, ctx);

    // Verify file was created
    expect(existsSync(testOutputPath)).toBe(true);
    expect(logger.hasMessage(`Exported database to ${testOutputPath}`)).toBe(
      true,
    );

    // Verify blob was returned
    expect(result.data).toBeInstanceOf(Blob);
    expect(result.data.size).toBeGreaterThan(0);
  });

  it('should export database that can be reloaded', async () => {
    await step.run(undefined, ctx);

    // Load the exported database
    const loadedDb = await PGliteDatabase.fromFile(testOutputPath);

    try {
      // Verify data was preserved
      const articles = await loadedDb.query<{id: string; title: string}>(
        'SELECT id, title FROM article',
      );
      expect(articles).toHaveLength(1);
      expect(articles[0].id).toBe('article-1');
      expect(articles[0].title).toBe('Test');
    } finally {
      await loadedDb.close();
    }
  });
});
