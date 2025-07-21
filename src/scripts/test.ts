import {getNotionClient, timeoutMs, Row} from '@lib/notion/client';
import {makeR2Uploader} from '@lib/storage/internal/r2';
import {LogLevel} from '@notionhq/client';
import 'dotenv/config';

async function main() {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error('R2_PUBLIC_URL environment variable is not set.');
  }

  const notion = getNotionClient({
    auth: process.env.NOTION_TOKEN!,
    dbId: process.env.NOTION_DB_ID!,
    logLevel: LogLevel.INFO,
    timeoutMs: timeoutMs.CI,
    storageUrlPrefix: publicUrl.replace(/\/$/, ''),
    upload: makeR2Uploader({
      bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      endpoint: process.env.CLOUDFLARE_R2_URL!,
      region: process.env.R2_REGION ?? 'auto',
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY!,
      publicUrl: publicUrl,
    }),
  });

  const rows: Row[] = await notion.getUpdatedRows();
  console.log(rows);
}

void main();
