import {
  getNotionClient,
  NotionClientParams,
  Row,
  timeoutMs,
} from './lib/notion/client';
import {LogLevel} from '@notionhq/client';
import 'dotenv/config';

// Example: Load from environment or config
const params: NotionClientParams = {
  auth: process.env.NOTION_TOKEN!,
  dbId: process.env.NOTION_DB_ID!,
  logLevel: LogLevel.DEBUG,
  timeoutMs: timeoutMs.DEFAULT,
};

async function main() {
  const notionClient = getNotionClient(params);

  // Get updated rows
  const rows: Row[] = await notionClient.getUpdatedRows();
  console.log('Updated rows:', rows);
}

main().catch(console.error);
