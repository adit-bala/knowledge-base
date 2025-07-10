import {db} from './db';
import {article} from '../schema/article';
import {embedArticle} from './embed';
import {getNotionClient, Row, timeoutMs, Status} from '../../lib/notion/client';
import {LogLevel} from '@notionhq/client';
import {inArray} from 'drizzle-orm';
import 'dotenv/config';

async function main() {
  const notion = getNotionClient({
    auth: process.env.NOTION_TOKEN!,
    dbId: process.env.NOTION_DB_ID!,
    logLevel: LogLevel.WARN,
    timeoutMs: timeoutMs.CI,
  });

  const rows: Row[] = await notion.getUpdatedRows();
  const published = rows.filter(r => r.status === Status.Published);

  // fetch lastEdited for existing articles
  const ids = published.map(r => r.id);
  const existing = await db
    .select({id: article.id, lastEdited: article.lastEdited})
    .from(article)
    .where(inArray(article.id, ids));

  const map = new Map(existing.map(r => [r.id, r.lastEdited.getTime()]));

  // upsert & collect changed
  const toEmbed: Row[] = [];
  for (const r of published) {
    const changed = map.get(r.id) !== r.lastEdited.getTime();
    await db
      .insert(article)
      .values({
        id: r.id,
        title: r.title,
        description: r.description,
        tags: r.tags,
        createdAt: r.createdAt,
        markdown: r.markdown,
        status: r.status,
        lastEdited: r.lastEdited,
      })
      .onConflictDoUpdate({
        target: article.id,
        set: {
          title: r.title,
          description: r.description,
          tags: r.tags,
          createdAt: r.createdAt,
          markdown: r.markdown,
          status: r.status,
          lastEdited: r.lastEdited,
        },
      });
    if (changed) toEmbed.push(r);
  }

  console.log(`Upserted ${published.length} articles.`);
  if (toEmbed.length) {
    console.log(`Embedding ${toEmbed.length} updated articles…`);
    for (const r of toEmbed) await embedArticle(r);
  } else {
    console.log('No articles changed – embeddings up to date.');
  }
}

main().catch(console.error);
