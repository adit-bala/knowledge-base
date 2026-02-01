/**
 * Generate embeddings for changed articles using LLM-generated descriptions.
 *
 * Instead of chunking articles, this step:
 * 1. Uses an LLM to generate a description and sample questions for each article
 * 2. Embeds that generated content using Transformers.js (all-MiniLM-L6-v2) for semantic search
 */

import crypto from 'crypto';
import OpenAI from 'openai';
import {pipeline, type FeatureExtractionPipeline} from '@xenova/transformers';
import type {OpenAIConfig} from '../config';
import {PipelineStep} from '../step';
import type {ProcessedArticle} from '../types';

type Config = OpenAIConfig;

// Singleton for the embedding pipeline
let embeddingPipeline: FeatureExtractionPipeline | null = null;

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
  }
  return embeddingPipeline;
}

const DESCRIPTION_PROMPT = `You are a helpful assistant that creates searchable descriptions for articles on Aditya's personal blog.

This is Aditya's personal blog where he writes about his life, experiences, hobbies, thoughts, projects, and interests. Visitors to the blog might ask questions like "What does Aditya do for fun?", "What are Aditya's hobbies?", "What has Aditya been working on?", "What does Aditya think about X?", etc.

Given the following article, create:
1. A comprehensive description (2-3 paragraphs) that captures the main themes, key points, and essence of the article. Reference Aditya by name where relevant.
2. 20 sample questions that someone visiting Aditya's blog might ask that this article could help answer. Include:
   - Personal questions about Aditya (e.g., "What does Aditya enjoy?", "What are Aditya's interests?")
   - Topic-specific questions about the article content
   - Questions about Aditya's experiences, opinions, and activities mentioned in the article
   - Questions phrased in different ways (formal and casual)

Format your response exactly like this:
DESCRIPTION:
[Your description here]

QUESTIONS:
1. [Question 1]
2. [Question 2]
3. [Question 3]
4. [Question 4]
5. [Question 5]
6. [Question 6]
7. [Question 7]
8. [Question 8]
9. [Question 9]
10. [Question 10]
11. [Question 11]
12. [Question 12]
13. [Question 13]
14. [Question 14]
15. [Question 15]
16. [Question 16]
17. [Question 17]
18. [Question 18]
19. [Question 19]
20. [Question 20]

Article Title: {title}

Article Content:
{content}`;

export class EmbedArticlesStep extends PipelineStep<
  ProcessedArticle[],
  void,
  Config
> {
  readonly name = 'embed-articles';
  readonly description =
    'Generate LLM descriptions and embeddings for changed articles';
  readonly phase = 'update' as const;

  protected async execute(articles: ProcessedArticle[]): Promise<void> {
    if (articles.length === 0) {
      this.log('No articles to embed');
      return;
    }

    const {apiKey, chatModel = 'gpt-4o-mini'} = this.config.openai;
    const openai = new OpenAI({apiKey});

    // Initialize embedding pipeline (Transformers.js)
    this.log('Loading Transformers.js embedding model...');
    const embedder = await getEmbeddingPipeline();
    this.log('Embedding model loaded');

    for (const article of articles) {
      await this.embedArticle(article, openai, chatModel, embedder);
    }

    this.log(`Embedded ${articles.length} articles`);
  }

  private async embedArticle(
    article: ProcessedArticle,
    openai: OpenAI,
    chatModel: string,
    embedder: FeatureExtractionPipeline,
  ): Promise<void> {
    // Delete existing embeddings
    await this.db.query('DELETE FROM embedding WHERE article_id = $1', [
      article.id,
    ]);

    // Generate description and questions using LLM
    const generatedContent = await this.generateDescription(
      article,
      openai,
      chatModel,
    );

    // Embed the generated content using Transformers.js
    const output = await embedder(generatedContent, {
      pooling: 'mean',
      normalize: true,
    });
    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array);

    const contentHash = crypto
      .createHash('md5')
      .update(generatedContent)
      .digest('hex');

    await this.db.query(
      `INSERT INTO embedding (article_id, chunk_idx, content, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        article.id,
        0, // Single embedding per article now
        generatedContent,
        contentHash,
        JSON.stringify(embedding),
      ],
    );
  }

  private async generateDescription(
    article: ProcessedArticle,
    openai: OpenAI,
    model: string,
  ): Promise<string> {
    // Truncate content if too long (keep under ~12k tokens for context)
    const maxContentLength = 40000;
    const content =
      article.markdown.length > maxContentLength
        ? article.markdown.slice(0, maxContentLength) +
          '\n\n[Content truncated]'
        : article.markdown;

    const prompt = DESCRIPTION_PROMPT.replace('{title}', article.title).replace(
      '{content}',
      content,
    );

    const response = await openai.chat.completions.create({
      model,
      messages: [{role: 'user', content: prompt}],
      temperature: 0.3, // Lower temperature for more consistent output
    });

    const generated = response.choices[0].message?.content ?? '';

    // Return the full generated content (description + questions)
    // This will be embedded for semantic search
    return `Title: ${article.title}\n\n${generated}`;
  }
}
