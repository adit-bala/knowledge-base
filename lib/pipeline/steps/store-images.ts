/**
 * Store downloaded images in database.
 */

import {PipelineStep} from '../step';
import type {ProcessedArticle} from '../types';

export class StoreImagesStep extends PipelineStep<
  ProcessedArticle[],
  ProcessedArticle[],
  object
> {
  readonly name = 'store-images';
  readonly description = 'Store downloaded images in database';
  readonly phase = 'update' as const;

  protected async execute(
    articles: ProcessedArticle[],
  ): Promise<ProcessedArticle[]> {
    let totalStored = 0;

    for (const article of articles) {
      for (const image of article.images) {
        await this.db.storeImage(
          image.id,
          image.data,
          image.mimeType,
          article.id,
          image.originalUrl,
        );
        totalStored++;
      }
    }

    this.log(`Stored ${totalStored} images`);
    return articles;
  }
}
