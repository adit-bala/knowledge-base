/**
 * Unit tests for TimestampDiffResolver.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {TimestampDiffResolver} from '../lib/pipeline/diff';
import {PGliteDatabase} from '../lib/db/pglite';
import type {FetchedArticle} from '../lib/pipeline/types';

describe('TimestampDiffResolver', () => {
  let resolver: TimestampDiffResolver;
  let db: PGliteDatabase;

  beforeEach(async () => {
    resolver = new TimestampDiffResolver();
    db = await PGliteDatabase.create();
    await db.initSchema();
  });

  afterEach(async () => {
    await db.close();
  });

  it('should identify new articles', async () => {
    const fetched: FetchedArticle[] = [
      {
        id: 'new-article',
        title: 'New',
        description: 'New article',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: 'content',
        images: new Map(),
      },
    ];

    const plan = await resolver.resolve(fetched, db);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].id).toBe('new-article');
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
  });

  it('should identify updated articles', async () => {
    const oldDate = new Date('2024-01-01');
    const newDate = new Date('2024-01-02');

    // Insert existing article with old timestamp
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'existing',
        'Old Title',
        'Desc',
        [],
        oldDate,
        'content',
        'published',
        oldDate,
      ],
    );

    const fetched: FetchedArticle[] = [
      {
        id: 'existing',
        title: 'Updated Title',
        description: 'Desc',
        tags: [],
        createdAt: oldDate,
        lastEdited: newDate, // Different timestamp
        status: 'published',
        markdown: 'updated content',
        images: new Map(),
      },
    ];

    const plan = await resolver.resolve(fetched, db);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe('existing');
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
  });

  it('should skip unchanged articles', async () => {
    const date = new Date('2024-01-01');

    // Insert existing article
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['unchanged', 'Title', 'Desc', [], date, 'content', 'published', date],
    );

    const fetched: FetchedArticle[] = [
      {
        id: 'unchanged',
        title: 'Title',
        description: 'Desc',
        tags: [],
        createdAt: date,
        lastEdited: date, // Same timestamp
        status: 'published',
        markdown: 'content',
        images: new Map(),
      },
    ];

    const plan = await resolver.resolve(fetched, db);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toSkip[0].id).toBe('unchanged');
    expect(plan.toDelete).toHaveLength(0);
  });

  it('should identify articles to delete', async () => {
    // Insert article that won't be in fetched list
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'to-delete',
        'Delete Me',
        'Desc',
        [],
        new Date(),
        'content',
        'published',
        new Date(),
      ],
    );

    const fetched: FetchedArticle[] = []; // Empty = all existing should be deleted

    const plan = await resolver.resolve(fetched, db);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(1);
    expect(plan.toDelete[0]).toBe('to-delete');
  });

  it('should handle mixed operations', async () => {
    const oldDate = new Date('2024-01-01');
    const newDate = new Date('2024-01-02');

    // Insert existing articles
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited) VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8),
       ($9, $10, $11, $12, $13, $14, $15, $16),
       ($17, $18, $19, $20, $21, $22, $23, $24)`,
      [
        'unchanged',
        'Unchanged',
        '',
        [],
        oldDate,
        '',
        'published',
        oldDate,
        'to-update',
        'Update',
        '',
        [],
        oldDate,
        '',
        'published',
        oldDate,
        'to-delete',
        'Delete',
        '',
        [],
        oldDate,
        '',
        'published',
        oldDate,
      ],
    );

    const fetched: FetchedArticle[] = [
      {
        id: 'unchanged',
        title: 'Unchanged',
        description: '',
        tags: [],
        createdAt: oldDate,
        lastEdited: oldDate,
        status: 'published',
        markdown: '',
        images: new Map(),
      },
      {
        id: 'to-update',
        title: 'Update',
        description: '',
        tags: [],
        createdAt: oldDate,
        lastEdited: newDate,
        status: 'published',
        markdown: '',
        images: new Map(),
      },
      {
        id: 'new-one',
        title: 'New',
        description: '',
        tags: [],
        createdAt: newDate,
        lastEdited: newDate,
        status: 'published',
        markdown: '',
        images: new Map(),
      },
    ];

    const plan = await resolver.resolve(fetched, db);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toDelete).toHaveLength(1);
  });
});
