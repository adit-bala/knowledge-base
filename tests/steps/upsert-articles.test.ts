/**
 * Unit tests for UpsertArticlesStep.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {UpsertArticlesStep} from '../../lib/pipeline/steps/upsert-articles';
import {PGliteDatabase} from '../../lib/db/pglite';
import {MockLogger} from '../mocks/logger';
import type {FetchedArticle, UpdatePlan} from '../../lib/pipeline/types';
import type {StepContext} from '../../lib/pipeline/step';
import type {Article} from '../../lib/db/schema';

describe('UpsertArticlesStep', () => {
  let step: UpsertArticlesStep;
  let db: PGliteDatabase;
  let logger: MockLogger;
  let ctx: StepContext<object>;

  beforeEach(async () => {
    step = new UpsertArticlesStep();
    db = await PGliteDatabase.create();
    await db.initSchema();
    logger = new MockLogger();
    ctx = {config: {}, logger, db};
  });

  afterEach(async () => {
    await db.close();
  });

  it('should insert new articles', async () => {
    const imageData = new TextEncoder().encode('test').buffer;
    const article: FetchedArticle = {
      id: 'new-article',
      title: 'New Article',
      description: 'A new article',
      tags: ['test'],
      createdAt: new Date('2024-01-01'),
      lastEdited: new Date('2024-01-02'),
      status: 'published',
      markdown: '![img](https://prod-files-secure.s3.amazonaws.com/test.png)',
      images: new Map([
        [
          'https://prod-files-secure.s3.amazonaws.com/test.png',
          {data: imageData, mimeType: 'image/png'},
        ],
      ]),
    };

    const plan: UpdatePlan<FetchedArticle> = {
      toCreate: [article],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
    };

    const result = await step.run(plan, ctx);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('new-article');
    expect(result.data[0].markdown).toContain('db://image/');
    expect(result.data[0].images).toHaveLength(1);

    // Verify article in database
    const articles = await db.query<Article>('SELECT * FROM article');
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('New Article');
  });

  it('should update existing articles', async () => {
    // Insert an existing article
    await db.query(
      `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'existing',
        'Old Title',
        'Old desc',
        [],
        new Date(),
        'old content',
        'published',
        new Date(),
      ],
    );

    const article: FetchedArticle = {
      id: 'existing',
      title: 'Updated Title',
      description: 'Updated desc',
      tags: ['updated'],
      createdAt: new Date('2024-01-01'),
      lastEdited: new Date('2024-01-03'),
      status: 'published',
      markdown: 'Updated content',
      images: new Map(),
    };

    const plan: UpdatePlan<FetchedArticle> = {
      toCreate: [],
      toUpdate: [article],
      toSkip: [],
      toDelete: [],
    };

    const result = await step.run(plan, ctx);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Updated Title');

    // Verify update in database
    const articles = await db.query<Article>('SELECT * FROM article');
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Updated Title');
  });

  it('should delete articles', async () => {
    // Insert articles to delete
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

    const plan: UpdatePlan<FetchedArticle> = {
      toCreate: [],
      toUpdate: [],
      toSkip: [],
      toDelete: ['to-delete'],
    };

    await step.run(plan, ctx);

    // Verify deletion
    const articles = await db.query<Article>('SELECT * FROM article');
    expect(articles).toHaveLength(0);
  });

  it('should replace image URLs with db:// references', async () => {
    const imageData = new TextEncoder().encode('test').buffer;
    const originalUrl = 'https://prod-files-secure.s3.amazonaws.com/test.png';

    const article: FetchedArticle = {
      id: 'article-1',
      title: 'Test',
      description: 'Test',
      tags: [],
      createdAt: new Date(),
      lastEdited: new Date(),
      status: 'published',
      markdown: `![img](${originalUrl})`,
      images: new Map([
        [originalUrl, {data: imageData, mimeType: 'image/png'}],
      ]),
    };

    const plan: UpdatePlan<FetchedArticle> = {
      toCreate: [article],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
    };

    const result = await step.run(plan, ctx);

    expect(result.data[0].markdown).not.toContain(originalUrl);
    expect(result.data[0].markdown).toMatch(/db:\/\/image\/[a-f0-9-]+/);
  });
});
