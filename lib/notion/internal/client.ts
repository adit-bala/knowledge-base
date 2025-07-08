import {
  Client,
  LogLevel,
  isFullPage,
  PageObjectResponse,
  APIResponseError,
  APIErrorCode,
} from '@notionhq/client';
import {NotionToMarkdown} from 'notion-to-md';

export enum Status {
  Draft = 'Draft',
  Published = 'Published',
}

export enum timeoutMs {
  DEFAULT = 60_000,
  CI = 30_000,
}

export interface Row {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: Date;
  markdown: string;
  status: Status;
  lastEdited: Date;
}

export interface NotionClient {
  notion: Client;
  getUpdatedRows: () => Promise<Row[]>;
}

export interface NotionClientParams {
  auth: string;
  dbId: string;
  logLevel?: LogLevel;
  timeoutMs?: number;
  maxRetries?: number;
}

const RATE_LIMIT_WAIT_MS = 340;

export function getNotionClient(params: NotionClientParams): NotionClient {
  const dbId = params.dbId;
  const maxRetries = params.maxRetries ?? 3;
  const notion = new Client({
    auth: params.auth,
    logLevel: params.logLevel ?? LogLevel.DEBUG,
    timeoutMs: params.timeoutMs ?? timeoutMs.DEFAULT,
  });

  async function withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err instanceof APIResponseError) {
        const transient = [
          APIErrorCode.RateLimited,
          APIErrorCode.ServiceUnavailable,
        ];
        if (transient.includes(err.code) && attempt <= maxRetries) {
          const wait = Math.pow(2, attempt) * 500;
          console.warn(
            `[NotionSync] transient error ${err.code}. retrying in ${wait}ms (attempt ${attempt})`,
          );
          await sleep(wait);
          return withRetry(fn, attempt + 1);
        }
      }
      throw err;
    }
  }

  function sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }

  async function pageToRow(page: PageObjectResponse): Promise<Row> {
    const getText = (propName: string): string => {
      const prop = page.properties[propName as keyof typeof page.properties];
      if (!prop) return '';
      if (prop.type === 'title') {
        return prop.title.map(t => t.plain_text).join('');
      }
      if (prop.type === 'rich_text') {
        return prop.rich_text.map(t => t.plain_text).join('');
      }
      return '';
    };
    const title = getText('Title');
    const description = getText('Description');
    const tagsProp = page.properties['Tags'];
    const tags =
      tagsProp && tagsProp.type === 'multi_select'
        ? tagsProp.multi_select.map(t => t.name)
        : [];
    const createdAtProp = page.properties['Created at'];
    const createdAt =
      createdAtProp && createdAtProp.type === 'created_time'
        ? new Date(createdAtProp.created_time)
        : new Date();
    const pageContentProp = page.properties['Page Content'];
    let markdown = '';
    if (
      pageContentProp &&
      pageContentProp.type === 'rich_text' &&
      Array.isArray(pageContentProp.rich_text)
    ) {
      const mention = pageContentProp.rich_text.find(
        (rt: any) =>
          rt.type === 'mention' && (rt as any).mention?.type === 'page',
      );
      const pageId = (mention as any)?.mention?.page?.id;
      if (pageId) {
        markdown = await getPostInMarkdown(pageId);
      }
    }
    const statusProp = page.properties['Status'];
    const status =
      statusProp &&
      statusProp.type === 'status' &&
      statusProp.status?.name === Status.Draft
        ? Status.Draft
        : Status.Published;
    return {
      id: page.id,
      title,
      description,
      tags,
      createdAt,
      markdown,
      status,
      lastEdited: new Date(page.last_edited_time),
    };
  }

  async function queryDatabase(): Promise<PageObjectResponse[]> {
    const pages: PageObjectResponse[] = [];
    let cursor: string | undefined;
    do {
      const resp = await withRetry(() =>
        notion.databases.query({
          database_id: dbId,
          start_cursor: cursor,
          page_size: 100,
          sorts: [
            {
              timestamp: 'last_edited_time',
              direction: 'ascending',
            },
          ],
        }),
      );
      const filtered = resp.results.filter(isFullPage) as PageObjectResponse[];
      pages.push(...filtered);
      cursor = resp.next_cursor ?? undefined;
      if (resp.has_more) await sleep(RATE_LIMIT_WAIT_MS);
    } while (cursor);
    return pages;
  }

  async function getUpdatedRows(): Promise<Row[]> {
    const pages = await queryDatabase();
    const rows: Row[] = [];
    for (const p of pages) {
      rows.push(await pageToRow(p));
    }
    return rows;
  }

  async function getPostInMarkdown(pageId: string): Promise<string> {
    const n2m = new NotionToMarkdown({notionClient: notion});
    const mdBlocks = await withRetry(() => n2m.pageToMarkdown(pageId));
    return n2m.toMarkdownString(mdBlocks).parent ?? '';
  }

  return {notion, getUpdatedRows};
}
