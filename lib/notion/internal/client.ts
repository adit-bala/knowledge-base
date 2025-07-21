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
  Draft = 'draft',
  Published = 'published',
  Archive = 'archive',
  InReview = 'in_review',
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

/** Upload raw bytes (e.g. from fetch ArrayBuffer) to a storage provider and
 *  return a publicly reachable URL pointing to the stored file. */
export interface ImageUploader {
  (params: {data: ArrayBuffer; sourceUrl: string}): Promise<string>;
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
  upload?: ImageUploader;
  storageUrlPrefix?: string;
}

const RATE_LIMIT_WAIT_MS = 340;
const DEFAULT_MAX_RETRIES = 3;

export function getNotionClient(params: NotionClientParams): NotionClient {
  const {
    auth,
    dbId,
    logLevel = LogLevel.DEBUG,
    timeoutMs: tmo = timeoutMs.DEFAULT,
    maxRetries = DEFAULT_MAX_RETRIES,
    upload,
    storageUrlPrefix,
  } = params;

  const notion = new Client({auth, logLevel, timeoutMs: tmo});

  // uploader provided by caller (e.g. Cloudflare R2 helper)
  const uploader: ImageUploader | undefined = upload;

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  const withRetry = async <T>(
    fn: () => Promise<T>,
    attempt = 1,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable =
        (err instanceof APIResponseError &&
          [APIErrorCode.RateLimited, APIErrorCode.ServiceUnavailable].includes(
            err.code,
          )) ||
        err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';

      if (isRetryable && attempt <= maxRetries) {
        const wait = 2 ** attempt * 500;
        const code =
          err instanceof APIResponseError ? err.code : err.cause?.code;
        console.warn(
          `[NotionSync] ${code}. retrying in ${wait}ms (attempt ${attempt})`,
        );
        await sleep(wait);
        return withRetry(fn, attempt + 1);
      }
      throw err;
    }
  };

  const getTextProp = (page: PageObjectResponse, name: string): string => {
    const prop = page.properties[name as keyof typeof page.properties];
    if (!prop) return '';
    if (prop.type === 'title')
      return prop.title.map(t => t.plain_text).join('');
    if (prop.type === 'rich_text')
      return prop.rich_text.map(t => t.plain_text).join('');
    return '';
  };

  const getMarkdown = async (pageId?: string, title = ''): Promise<string> => {
    if (!pageId) return '';
    const n2m = new NotionToMarkdown({notionClient: notion});

    if (upload) {
      n2m.setCustomTransformer('image', async (block: any) => {
        // ignore if the image is already in our storage bucket
        const currentSrc =
          block.image.type === 'external'
            ? block.image.external.url
            : block.image.file.url;
        if (storageUrlPrefix && currentSrc.startsWith(storageUrlPrefix)) {
          return false;
        }

        // Download the original image
        const res = await withRetry(() => fetch(currentSrc));
        if (!res.ok) return false; // fallback to default if fetch fails
        const data = await res.arrayBuffer();

        // Upload to the configured storage provider
        const destUrl = await uploader!({data, sourceUrl: currentSrc});

        // Patch the Notion block so future fetches are already migrated
        await withRetry(() =>
          notion.blocks.update({
            block_id: block.id,
            image: {external: {url: destUrl}},
          }),
        );

        // Build the markdown line for this image
        const caption = (block.image.caption || [])
          .map((c: any) => c.plain_text)
          .join('');
        return `![${caption}](${destUrl})`;
      });
    }

    const mdBlocks = await withRetry(() => n2m.pageToMarkdown(pageId));
    const body = n2m.toMarkdownString(mdBlocks).parent ?? '';
    return `# ${title}\n\n${body}`.trim();
  };
  const pageToRow = async (p: PageObjectResponse): Promise<Row> => {
    const title = getTextProp(p, 'Title');

    const tags =
      p.properties['Tags']?.type === 'multi_select'
        ? p.properties['Tags'].multi_select.map(t => t.name)
        : [];

    const createdAt =
      p.properties['Created at']?.type === 'date'
        ? new Date(p.properties['Created at'].date?.start || '')
        : new Date(p.created_time);

    let markdown = '';
    const pc = p.properties['Page Content'];
    if (pc?.type === 'rich_text') {
      const mention = pc.rich_text.find(
        rt => rt.type === 'mention' && (rt as any).mention?.type === 'page',
      );
      markdown = await getMarkdown((mention as any)?.mention?.page?.id, title);
    }

    const statusProp = p.properties['Status'];
    const status =
      statusProp?.type === 'status'
        ? (statusProp.status?.name as Status)
        : Status.Published;

    return {
      id: p.id,
      title,
      description: getTextProp(p, 'Description'),
      tags,
      createdAt,
      markdown,
      status,
      lastEdited: new Date(p.last_edited_time),
    };
  };

  const queryDatabase = async (): Promise<PageObjectResponse[]> => {
    const pages: PageObjectResponse[] = [];
    let cursor: string | undefined;
    do {
      const resp = await withRetry(() =>
        notion.databases.query({
          database_id: dbId,
          start_cursor: cursor,
          page_size: 100,
          sorts: [{timestamp: 'last_edited_time', direction: 'ascending'}],
        }),
      );
      pages.push(...resp.results.filter(isFullPage));
      cursor = resp.next_cursor ?? undefined;
      if (resp.has_more) await sleep(RATE_LIMIT_WAIT_MS);
    } while (cursor);
    return pages;
  };

  /** Public: return all rows (in parallel) */
  const getUpdatedRows = async (): Promise<Row[]> => {
    const pages = await queryDatabase();
    return Promise.all(pages.map(pageToRow));
  };

  return {notion, getUpdatedRows};
}
