/**
 * Unit tests for EmbedArticlesStep.
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {EmbedArticlesStep} from '../../lib/pipeline/steps/embed-articles';
import {PGliteDatabase} from '../../lib/db/pglite';
import {MockLogger} from '../mocks/logger';
import {
  createMockEmbeddingResponse,
  generateMockDescription,
  createMockChatResponse,
} from '../mocks/openai-client';
import type {ProcessedArticle} from '../../lib/pipeline/types';
import type {StepContext} from '../../lib/pipeline/step';
import type {OpenAIConfig} from '../../lib/pipeline/config';
import type {Embedding} from '../../lib/db/schema';

// Mock OpenAI module
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
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
                const userMessage = params.messages.find(
                  m => m.role === 'user',
                );
                const titleMatch =
                  userMessage?.content.match(/Article Title: (.+)/);
                const title = titleMatch ? titleMatch[1] : 'Unknown Article';
                return createMockChatResponse(generateMockDescription(title));
              },
            ),
        },
      };
    },
  };
});

describe('EmbedArticlesStep', () => {
  let step: EmbedArticlesStep;
  let db: PGliteDatabase;
  let logger: MockLogger;
  let ctx: StepContext<OpenAIConfig>;

  beforeEach(async () => {
    step = new EmbedArticlesStep();
    db = await PGliteDatabase.create();
    await db.initSchema();
    logger = new MockLogger();
    ctx = {
      config: {openai: {apiKey: 'test-key'}},
      logger,
      db,
    };

    // Insert a test article
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

  it('should generate LLM description and embedding for articles', async () => {
    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Test Article',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: 'This is a test article with some content for embedding.',
        images: [],
      },
    ];

    await step.run(articles, ctx);

    // Verify embedding was created with LLM-generated content
    const embeddings = await db.query<Embedding>('SELECT * FROM embedding');
    expect(embeddings.length).toBe(1); // Single embedding per article now
    expect(embeddings[0].article_id).toBe('article-1');
    expect(embeddings[0].content).toContain('DESCRIPTION:');
    expect(embeddings[0].content).toContain('QUESTIONS:');
    expect(embeddings[0].content).toContain('Test Article');
  });

  it('should delete existing embeddings before creating new ones', async () => {
    // Insert existing embedding
    await db.query(
      `INSERT INTO embedding (article_id, chunk_idx, content, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'article-1',
        0,
        'old content',
        'hash',
        JSON.stringify(new Array(1536).fill(0)),
      ],
    );

    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Test',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: 'New content',
        images: [],
      },
    ];

    await step.run(articles, ctx);

    // Verify old embeddings are gone and new ones exist
    const embeddings = await db.query<Embedding>('SELECT * FROM embedding');
    expect(embeddings.length).toBe(1);
    expect(embeddings[0].content).not.toBe('old content');
    expect(embeddings[0].content).toContain('DESCRIPTION:');
  });

  it('should handle empty article list', async () => {
    await step.run([], ctx);
    expect(logger.hasMessage('No articles to embed')).toBe(true);
  });

  it('should create single embedding even for long content', async () => {
    // Create a long article - should still result in single embedding
    const longContent = 'This is a paragraph. '.repeat(200);

    const articles: ProcessedArticle[] = [
      {
        id: 'article-1',
        title: 'Long Article',
        description: 'Test',
        tags: [],
        createdAt: new Date(),
        lastEdited: new Date(),
        status: 'published',
        markdown: longContent,
        images: [],
      },
    ];

    await step.run(articles, ctx);

    // Verify single embedding was created (no chunking)
    const embeddings = await db.query<Embedding>('SELECT * FROM embedding');
    expect(embeddings.length).toBe(1);
    expect(embeddings[0].content).toContain('Long Article');
  });
});
