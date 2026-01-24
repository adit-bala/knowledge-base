/**
 * Fetch published articles from Notion database.
 */

import {Client, LogLevel, isFullPage} from '@notionhq/client';
import type {PageObjectResponse} from '@notionhq/client/build/src/api-endpoints';
import {NotionToMarkdown} from 'notion-to-md';
import type {NotionConfig} from '../config';
import {PipelineStep} from '../step';
import type {FetchedArticle} from '../types';

type Config = NotionConfig;

export class FetchNotionStep extends PipelineStep<
  void,
  FetchedArticle[],
  Config
> {
  readonly name = 'fetch-notion';
  readonly description = 'Fetch published articles from Notion database';
  readonly phase = 'fetch' as const;

  protected async execute(): Promise<FetchedArticle[]> {
    const {token, dbId, timeoutMs = 30_000} = this.config.notion;

    const notion = new Client({
      auth: token,
      timeoutMs,
      logLevel: LogLevel.WARN,
    });
    const n2m = new NotionToMarkdown({notionClient: notion});

    // Query database for published articles
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: 'Status',
        status: {equals: 'Published'},
      },
    });

    const articles: FetchedArticle[] = [];

    for (const page of response.results) {
      if (!isFullPage(page)) continue;

      const article = await this.pageToArticle(page, n2m);
      articles.push(article);
    }

    this.log(`Fetched ${articles.length} published articles`);
    return articles;
  }

  private getTextProp(page: PageObjectResponse, name: string): string {
    const prop = page.properties[name];
    if (!prop) return '';
    if (prop.type === 'title') {
      return prop.title.map(t => t.plain_text).join('');
    }
    if (prop.type === 'rich_text') {
      return prop.rich_text.map(t => t.plain_text).join('');
    }
    return '';
  }

  private async getMarkdown(
    n2m: NotionToMarkdown,
    pageId: string | undefined,
    title: string,
  ): Promise<string> {
    if (!pageId) return '';
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    const body = n2m.toMarkdownString(mdBlocks).parent ?? '';
    return `# ${title}\n\n${body}`.trim();
  }

  private async pageToArticle(
    page: PageObjectResponse,
    n2m: NotionToMarkdown,
  ): Promise<FetchedArticle> {
    const title = this.getTextProp(page, 'Title');

    const tagsProp = page.properties['Tags'];
    const tags =
      tagsProp?.type === 'multi_select'
        ? tagsProp.multi_select.map(t => t.name)
        : [];

    const createdAtProp = page.properties['Created at'];
    const createdAt =
      createdAtProp?.type === 'date' && createdAtProp.date?.start
        ? new Date(createdAtProp.date.start)
        : new Date(page.created_time);

    // Check for Page Content property with a page mention
    let markdown = '';
    const pageContentProp = page.properties['Page Content'];
    if (pageContentProp?.type === 'rich_text') {
      const mention = pageContentProp.rich_text.find(
        rt =>
          rt.type === 'mention' &&
          (rt as {mention?: {type?: string}}).mention?.type === 'page',
      );
      if (mention) {
        const mentionData = mention as {mention?: {page?: {id?: string}}};
        const linkedPageId = mentionData.mention?.page?.id;
        markdown = await this.getMarkdown(n2m, linkedPageId, title);
      }
    }

    // Fallback: convert the page itself to markdown if no Page Content
    if (!markdown) {
      markdown = await this.getMarkdown(n2m, page.id, title);
    }

    return {
      id: page.id,
      title: title || 'Untitled',
      description: this.getTextProp(page, 'Description'),
      tags,
      createdAt,
      lastEdited: new Date(page.last_edited_time),
      status: 'published',
      markdown,
      images: new Map(), // Populated by next step
    };
  }
}
