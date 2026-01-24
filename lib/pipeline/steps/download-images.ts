/**
 * Download images from Notion to store in database.
 */

import {PipelineStep} from '../step';
import type {FetchedArticle} from '../types';

/** Regex to find image URLs in markdown */
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;
const NOTION_IMAGE_HOSTS = [
  'prod-files-secure.s3',
  'amazonaws.com',
  'notion.so',
];

export class DownloadImagesStep extends PipelineStep<
  FetchedArticle[],
  FetchedArticle[],
  object
> {
  readonly name = 'download-images';
  readonly description = 'Download images from Notion to store in database';
  readonly phase = 'fetch' as const;

  protected async execute(
    articles: FetchedArticle[],
  ): Promise<FetchedArticle[]> {
    let totalImages = 0;

    for (const article of articles) {
      const imageUrls = this.extractImageUrls(article.markdown);

      for (const url of imageUrls) {
        if (article.images.has(url)) continue; // Already downloaded

        try {
          const {data, mimeType} = await this.downloadImage(url);
          article.images.set(url, {data, mimeType});
          totalImages++;
        } catch (error) {
          this.log(`Failed to download image: ${url} - ${error}`, 'error');
        }
      }
    }

    this.log(
      `Downloaded ${totalImages} images from ${articles.length} articles`,
    );
    return articles;
  }

  private extractImageUrls(markdown: string): string[] {
    const urls: string[] = [];
    let match: RegExpExecArray | null;

    // Reset regex lastIndex
    IMAGE_REGEX.lastIndex = 0;

    while ((match = IMAGE_REGEX.exec(markdown)) !== null) {
      const url = match[2];
      // Only download Notion-hosted images (external images stay as URLs)
      if (NOTION_IMAGE_HOSTS.some(host => url.includes(host))) {
        urls.push(url);
      }
    }

    return urls;
  }

  private async downloadImage(
    url: string,
  ): Promise<{data: ArrayBuffer; mimeType: string}> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.arrayBuffer();
    const mimeType =
      response.headers.get('content-type') ?? 'application/octet-stream';

    return {data, mimeType};
  }
}
