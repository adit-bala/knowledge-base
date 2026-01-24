/**
 * Insert or update changed articles in database.
 */

import {randomUUID} from 'crypto';
import {PipelineStep} from '../step';
import type {FetchedArticle, ProcessedArticle, UpdatePlan} from '../types';

/** Replace Notion image URLs with db:// references */
function processMarkdownImages(
  markdown: string,
  images: Map<string, {data: ArrayBuffer; mimeType: string}>,
): {markdown: string; imageRecords: ProcessedArticle['images']} {
  const imageRecords: ProcessedArticle['images'] = [];

  let processed = markdown;
  for (const [originalUrl, {data, mimeType}] of images) {
    const id = randomUUID();
    imageRecords.push({id, data, mimeType, originalUrl});

    // Replace URL with db:// reference
    processed = processed.split(originalUrl).join(`db://image/${id}`);
  }

  return {markdown: processed, imageRecords};
}

export class UpsertArticlesStep extends PipelineStep<
  UpdatePlan<FetchedArticle>,
  ProcessedArticle[],
  object
> {
  readonly name = 'upsert-articles';
  readonly description = 'Insert or update changed articles in database';
  readonly phase = 'update' as const;

  protected async execute(
    plan: UpdatePlan<FetchedArticle>,
  ): Promise<ProcessedArticle[]> {
    const processed: ProcessedArticle[] = [];

    // Handle deletions first
    if (plan.toDelete.length > 0) {
      const ids = plan.toDelete.map(id => `'${id}'`).join(',');
      await this.db.exec(`DELETE FROM article WHERE id IN (${ids})`);
      this.log(`Deleted ${plan.toDelete.length} articles`);
    }

    // Process creates and updates
    const toProcess = [...plan.toCreate, ...plan.toUpdate];

    for (const article of toProcess) {
      const {markdown, imageRecords} = processMarkdownImages(
        article.markdown,
        article.images,
      );

      // Upsert article
      await this.db.query(
        `INSERT INTO article (id, title, description, tags, created_at, markdown, status, last_edited)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           tags = EXCLUDED.tags,
           markdown = EXCLUDED.markdown,
           status = EXCLUDED.status,
           last_edited = EXCLUDED.last_edited`,
        [
          article.id,
          article.title,
          article.description,
          article.tags,
          article.createdAt,
          markdown,
          article.status,
          article.lastEdited,
        ],
      );

      processed.push({
        ...article,
        markdown,
        images: imageRecords,
      });
    }

    this.log(
      `Upserted ${toProcess.length} articles (${plan.toCreate.length} new, ${plan.toUpdate.length} updated)`,
    );
    return processed;
  }
}
