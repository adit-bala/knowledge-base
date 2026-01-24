/**
 * Unit tests for DownloadImagesStep.
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {DownloadImagesStep} from '../../lib/pipeline/steps/download-images';
import {PGliteDatabase} from '../../lib/db/pglite';
import {MockLogger} from '../mocks/logger';
import type {FetchedArticle} from '../../lib/pipeline/types';
import type {StepContext} from '../../lib/pipeline/step';

describe('DownloadImagesStep', () => {
  let step: DownloadImagesStep;
  let db: PGliteDatabase;
  let logger: MockLogger;
  let ctx: StepContext<object>;

  beforeEach(async () => {
    step = new DownloadImagesStep();
    db = await PGliteDatabase.create();
    await db.initSchema();
    logger = new MockLogger();
    ctx = {config: {}, logger, db};

    // Mock fetch for image downloads
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode(`image-data-${url}`).buffer,
        headers: new Map([['content-type', 'image/png']]),
      };
    });
  });

  afterEach(async () => {
    await db.close();
    vi.restoreAllMocks();
  });

  it('should extract and download Notion images', async () => {
    const articles: FetchedArticle[] = [
      {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: '![Alt](https://prod-files-secure.s3.amazonaws.com/img.png)',
        images: new Map(),
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].images.size).toBe(1);
    expect(
      result.data[0].images.has(
        'https://prod-files-secure.s3.amazonaws.com/img.png',
      ),
    ).toBe(true);
  });

  it('should skip non-Notion images', async () => {
    const articles: FetchedArticle[] = [
      {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: '![Alt](https://example.com/external.png)',
        images: new Map(),
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data[0].images.size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle download failures gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const articles: FetchedArticle[] = [
      {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: '![Alt](https://prod-files-secure.s3.amazonaws.com/img.png)',
        images: new Map(),
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data[0].images.size).toBe(0);
    expect(logger.getErrors().length).toBeGreaterThan(0);
  });

  it('should handle multiple images in one article', async () => {
    const articles: FetchedArticle[] = [
      {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown:
          '![A](https://prod-files-secure.s3.amazonaws.com/a.png)\n![B](https://prod-files-secure.s3.amazonaws.com/b.png)',
        images: new Map(),
      },
    ];

    const result = await step.run(articles, ctx);

    expect(result.data[0].images.size).toBe(2);
  });
});
