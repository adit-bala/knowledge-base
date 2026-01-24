/**
 * Full integration test for the sync pipeline.
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {existsSync, unlinkSync} from 'fs';
import {SyncPipeline} from '../lib/pipeline/pipeline';
import {DownloadImagesStep} from '../lib/pipeline/steps/download-images';
import {UpsertArticlesStep} from '../lib/pipeline/steps/upsert-articles';
import {StoreImagesStep} from '../lib/pipeline/steps/store-images';
import {EmbedArticlesStep} from '../lib/pipeline/steps/embed-articles';
import {ExportDatabaseStep} from '../lib/pipeline/steps/export-database';
import {PipelineStep} from '../lib/pipeline/step';
import {MockLogger} from './mocks/logger';
import {
  createMockEmbeddingResponse,
  createMockChatResponse,
  generateMockDescription,
} from './mocks/openai-client';
import type {FetchedArticle} from '../lib/pipeline/types';
import type {SyncPipelineConfig} from '../lib/pipeline/config';

// Mock OpenAI
vi.mock('openai', () => ({
  default: class {
    embeddings = {
      create: vi
        .fn()
        .mockImplementation(async (params: {input: string | string[]}) => {
          return createMockEmbeddingResponse(params.input);
        }),
    };
    chat = {
      completions: {
        create: vi
          .fn()
          .mockImplementation(
            async (params: {
              model: string;
              messages: Array<{role: string; content: string}>;
            }) => {
              const userMessage = params.messages.find(m => m.role === 'user');
              const titleMatch =
                userMessage?.content.match(/Article Title: (.+)/);
              const title = titleMatch ? titleMatch[1] : 'Unknown Article';
              return createMockChatResponse(generateMockDescription(title));
            },
          ),
      },
    };
  },
}));

/**
 * Mock fetch step that returns pre-configured articles.
 */
class MockFetchNotionStep extends PipelineStep<void, FetchedArticle[], object> {
  readonly name = 'mock-fetch-notion';
  readonly description = 'Mock fetch for testing';
  readonly phase = 'fetch' as const;

  constructor(private articles: FetchedArticle[]) {
    super();
  }

  protected async execute(): Promise<FetchedArticle[]> {
    return this.articles;
  }
}

describe('SyncPipeline Integration', () => {
  let logger: MockLogger;
  const testOutputPath = './test-pipeline-export.db.tar.gz';

  beforeEach(() => {
    logger = new MockLogger();

    // Mock fetch for image downloads
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('fake-image').buffer,
      headers: new Map([['content-type', 'image/png']]),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(testOutputPath)) {
      unlinkSync(testOutputPath);
    }
  });

  it('should run complete pipeline with mock data', async () => {
    const mockArticles: FetchedArticle[] = [
      {
        id: 'article-1',
        title: 'Test Article 1',
        description: 'First test article',
        tags: ['test'],
        createdAt: new Date('2024-01-01'),
        lastEdited: new Date('2024-01-02'),
        status: 'published',
        markdown:
          '# Test\n\n![img](https://prod-files-secure.s3.amazonaws.com/test.png)\n\nContent here.',
        images: new Map(),
      },
      {
        id: 'article-2',
        title: 'Test Article 2',
        description: 'Second test article',
        tags: ['test', 'example'],
        createdAt: new Date('2024-01-01'),
        lastEdited: new Date('2024-01-03'),
        status: 'published',
        markdown: '# Second\n\nNo images here.',
        images: new Map(),
      },
    ];

    const config: SyncPipelineConfig = {
      logger,
      notion: {token: 'test', dbId: 'test'},
      openai: {apiKey: 'test-key'},
      export: {outputPath: testOutputPath},
    };

    const pipeline = new SyncPipeline(config);

    // Add steps
    pipeline.addStep(new MockFetchNotionStep(mockArticles));
    pipeline.addStep(new DownloadImagesStep());
    pipeline.addStep(new UpsertArticlesStep());
    pipeline.addStep(new StoreImagesStep());
    pipeline.addStep(new EmbedArticlesStep());
    pipeline.addStep(new ExportDatabaseStep());

    const result = await pipeline.run();

    // Verify pipeline completed successfully
    expect(result.success).toBe(true);
    expect(result.totalDuration).toBeGreaterThan(0);

    // Verify phases ran
    expect(result.phases.fetch.steps).toHaveLength(2);
    expect(result.phases.update.steps).toHaveLength(3);
    expect(result.phases.upload.steps).toHaveLength(1);

    // Verify diff detected new articles
    expect(result.phases.diff.plan.toCreate).toHaveLength(2);
    expect(result.phases.diff.plan.toUpdate).toHaveLength(0);
    expect(result.phases.diff.plan.toSkip).toHaveLength(0);

    // Verify export file was created
    expect(existsSync(testOutputPath)).toBe(true);
  });

  it('should skip unchanged articles on second run', async () => {
    const article: FetchedArticle = {
      id: 'article-1',
      title: 'Test',
      description: 'Test',
      tags: [],
      createdAt: new Date('2024-01-01'),
      lastEdited: new Date('2024-01-02'),
      status: 'published',
      markdown: '# Test\n\nContent.',
      images: new Map(),
    };

    const config: SyncPipelineConfig = {
      logger,
      notion: {token: 'test', dbId: 'test'},
      openai: {apiKey: 'test-key'},
      export: {outputPath: testOutputPath},
    };

    // First run
    const pipeline1 = new SyncPipeline(config);
    pipeline1.addStep(new MockFetchNotionStep([article]));
    pipeline1.addStep(new DownloadImagesStep());
    pipeline1.addStep(new UpsertArticlesStep());
    pipeline1.addStep(new StoreImagesStep());
    pipeline1.addStep(new EmbedArticlesStep());
    pipeline1.addStep(new ExportDatabaseStep());
    await pipeline1.run();

    // Second run with same article (load from exported file)
    const config2: SyncPipelineConfig = {
      ...config,
      existingDbPath: testOutputPath,
    };

    const pipeline2 = new SyncPipeline(config2);
    pipeline2.addStep(new MockFetchNotionStep([article]));
    pipeline2.addStep(new DownloadImagesStep());
    pipeline2.addStep(new UpsertArticlesStep());
    pipeline2.addStep(new StoreImagesStep());
    pipeline2.addStep(new EmbedArticlesStep());
    pipeline2.addStep(new ExportDatabaseStep());

    const result2 = await pipeline2.run();

    // Article should be skipped
    expect(result2.phases.diff.plan.toCreate).toHaveLength(0);
    expect(result2.phases.diff.plan.toSkip).toHaveLength(1);
  });
});
