/**
 * Mock Notion client for testing.
 */

import type {FetchedArticle} from '../../lib/pipeline/types';

export interface MockNotionPage {
  id: string;
  properties: {
    Name: {title: [{plain_text: string}]};
    Description: {rich_text: [{plain_text: string}]};
    Tags: {multi_select: Array<{name: string}>};
    Status: {status: {name: string}};
  };
  created_time: string;
  last_edited_time: string;
}

export interface MockNotionConfig {
  pages: MockNotionPage[];
  markdownContent: Map<string, string>;
}

/**
 * Create a mock Notion page for testing.
 */
export function createMockNotionPage(
  article: Omit<FetchedArticle, 'images'>,
): MockNotionPage {
  return {
    id: article.id,
    properties: {
      Name: {title: [{plain_text: article.title}]},
      Description: {rich_text: [{plain_text: article.description}]},
      Tags: {multi_select: article.tags.map(name => ({name}))},
      Status: {status: {name: 'Published'}},
    },
    created_time: article.createdAt.toISOString(),
    last_edited_time: article.lastEdited.toISOString(),
  };
}

/**
 * Create mock articles for testing.
 */
export function createMockArticles(count: number): FetchedArticle[] {
  const articles: FetchedArticle[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    articles.push({
      id: `article-${i + 1}`,
      title: `Test Article ${i + 1}`,
      description: `Description for article ${i + 1}`,
      tags: ['test', `tag-${i + 1}`],
      createdAt: new Date(now.getTime() - i * 86400000),
      lastEdited: new Date(now.getTime() - i * 3600000),
      status: 'published',
      markdown: `# Test Article ${i + 1}\n\nThis is the content for article ${i + 1}.\n\n![Image](https://prod-files-secure.s3.amazonaws.com/test-image-${i + 1}.png)`,
      images: new Map(),
    });
  }

  return articles;
}

/**
 * Create a mock article with no images.
 */
export function createMockArticleWithoutImages(): FetchedArticle {
  return {
    id: 'article-no-images',
    title: 'Article Without Images',
    description: 'This article has no images',
    tags: ['test'],
    createdAt: new Date(),
    lastEdited: new Date(),
    status: 'published',
    markdown: '# No Images\n\nJust text content.',
    images: new Map(),
  };
}

/**
 * Create a mock article with images already downloaded.
 */
export function createMockArticleWithImages(): FetchedArticle {
  const imageData = new TextEncoder().encode('fake-image-data').buffer;
  const images = new Map<string, {data: ArrayBuffer; mimeType: string}>();
  images.set('https://prod-files-secure.s3.amazonaws.com/test-image.png', {
    data: imageData,
    mimeType: 'image/png',
  });

  return {
    id: 'article-with-images',
    title: 'Article With Images',
    description: 'This article has images',
    tags: ['test'],
    createdAt: new Date(),
    lastEdited: new Date(),
    status: 'published',
    markdown:
      '# With Images\n\n![Alt](https://prod-files-secure.s3.amazonaws.com/test-image.png)',
    images,
  };
}
