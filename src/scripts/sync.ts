import {
  getPgDrizzle,
  sqliteTableExists,
  withSqliteConnection,
  closePgPool,
} from '@db/db';
import {article} from '@schema/article';
import {embedArticle} from './embed';
import {getNotionClient, Row, timeoutMs, Status} from '@notion/client';
import {LogLevel} from '@notionhq/client';
import {inArray, eq} from 'drizzle-orm';
import {drizzle as drizzleSQLite} from 'drizzle-orm/better-sqlite3';
import {notionEmbedding} from '@schema/notion';
import * as dotenv from 'dotenv';
dotenv.config({override: true});

const db = getPgDrizzle({article});

async function needsEmbedding(
  row: Row,
  existingLastEdited?: number,
): Promise<boolean> {
  // Check if article is new or modified in PostgreSQL
  const isNew = existingLastEdited === undefined;
  const isModified = !isNew && existingLastEdited !== row.lastEdited.getTime();

  if (isNew || isModified) {
    return true;
  }

  // Check if embeddings exist in SQLite cache
  if (sqliteTableExists('notion_embedding')) {
    const existingEmbeddings = await withSqliteConnection(async sqlite => {
      const sqliteDb = drizzleSQLite(sqlite);
      return await sqliteDb
        .select()
        .from(notionEmbedding)
        .where(eq(notionEmbedding.articleId, row.id))
        .limit(1);
    });

    // If no embeddings exist in SQLite, we need to embed
    return existingEmbeddings.length === 0;
  }

  // If SQLite table doesn't exist, assume we need to embed
  return true;
}

async function main() {
  const notion = getNotionClient({
    auth: process.env.NOTION_TOKEN!,
    dbId: process.env.NOTION_DB_ID!,
    logLevel: LogLevel.INFO,
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
    const existingLastEdited = map.get(r.id);
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

    const needsEmbed = await needsEmbedding(r, existingLastEdited);
    if (needsEmbed) toEmbed.push(r);
  }

  console.log(`Added/Updated ${published.length} articles.`);
  if (toEmbed.length) {
    console.log(`Embedding ${toEmbed.length} updated articles…`);
    for (const r of toEmbed) await embedArticle(r);
  } else {
    console.log('No articles changed – embeddings up to date.');
  }
}

main()
  .catch(console.error)
  .finally(() => closePgPool());
