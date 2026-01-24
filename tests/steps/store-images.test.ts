/**
 * Unit tests for StoreImagesStep.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {StoreImagesStep} from '../../lib/pipeline/steps/store-images';
import {PGliteDatabase} from '../../lib/db/pglite';
import {MockLogger} from '../mocks/logger';
import type {ProcessedArticle} from '../../lib/pipeline/types';
import type {StepContext} from '../../lib/pipeline/step';

describe('StoreImagesStep', () => {
  let step: StoreImagesStep;
  let db: PGliteDatabase;
  let logger: MockLogger;
  let ctx: StepContext<object>;

  beforeEach(async () => {
    step = new StoreImagesStep();
    db = await PGliteDatabase.create();
    await db.initSchema();
    logger = new MockLogger();
    ctx = {config: {}, logger, db};

    // Insert a test article first (images have foreign key reference)
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
  });

  it('should store images in database', async () => {
    const imageData = new TextEncoder().encode('test-image-data').buffer;

    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: '![img](db://image/img-1)',
        images: [
          {
            id: 'img-1',
            data: imageData,
            mimeType: 'image/png',
            originalUrl: 'https://example.com/img.png',
          },
        ],
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data).toHaveLength(1);
    expect(logger.hasMessage('Stored 1 images')).toBe(true);

    // Verify image in database
    const storedImage = await db.getImage('img-1');
    expect(storedImage).not.toBeNull();
    expect(storedImage?.mimeType).toBe('image/png');
  });

  it('should store multiple images', async () => {
    const imageData = new TextEncoder().encode('test').buffer;

    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: '![a](db://image/a) ![b](db://image/b)',
        images: [
          {
            id: 'a',
            data: imageData,
            mimeType: 'image/png',
            originalUrl: 'url-a',
          },
          {
            id: 'b',
            data: imageData,
            mimeType: 'image/jpeg',
            originalUrl: 'url-b',
          },
        ],
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data).toHaveLength(1);
    expect(logger.hasMessage('Stored 2 images')).toBe(true);

    // Verify both images
    expect(await db.getImage('a')).not.toBeNull();
    expect(await db.getImage('b')).not.toBeNull();
  });

  it('should handle articles with no images', async () => {
    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: 'No images here',
        images: [],
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data).toHaveLength(1);
    expect(logger.hasMessage('Stored 0 images')).toBe(true);
  });
});
