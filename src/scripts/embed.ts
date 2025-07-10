import {pgDb, getSqliteConnection, sqliteTableExists} from '../../lib/db/db';
import {Row} from '../../lib/notion/client';
import {embedding} from '../schema/embedding';
import {eq, and} from 'drizzle-orm';
import {RecursiveCharacterTextSplitter} from 'langchain/text_splitter';
import OpenAI from 'openai';
import crypto from 'crypto';
import {drizzle as drizzleSQLite} from 'drizzle-orm/better-sqlite3';
import {notionEmbedding} from '../schema/notion';
import 'dotenv/config';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1024,
  chunkOverlap: 200,
  separators: ['\n## ', '\n### ', '\n\n', '\n', ' '],
});
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY!});

function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

export async function embedArticle(row: Row) {
  await pgDb.transaction(async tx => {
    const contentHash = generateContentHash(row.markdown);
    const sqliteTableExistsFlag = sqliteTableExists('notion_embedding');
    if (sqliteTableExistsFlag) {
      console.log(`SQLite embedding table found - checking for cached embeddings`);
    } else {
      console.log(`SQLite embedding table not found - will compute new embeddings`);
    }
    if (sqliteTableExistsFlag) {
      const sqlite = getSqliteConnection();
      const sqliteDb = drizzleSQLite(sqlite);
      const existingEmbeddings = await sqliteDb
        .select()
        .from(notionEmbedding)
        .where(and(
          eq(notionEmbedding.articleId, row.id),
          eq(notionEmbedding.contentHash, contentHash)
        ));
      if (existingEmbeddings.length > 0) {
        console.log(`Found existing embeddings for article ${row.id} - reusing from SQLite`);
        
        // 1. purge old vectors from PostgreSQL
        await tx.delete(embedding).where(eq(embedding.articleId, row.id));
        
        // 2. copy embeddings from SQLite to PostgreSQL
        for (const sqliteEmbedding of existingEmbeddings) {
          await tx.insert(embedding).values({
            articleId: sqliteEmbedding.articleId,
            chunkIdx: sqliteEmbedding.chunkIdx,
            content: sqliteEmbedding.content,
            embedding: sqliteEmbedding.embedding,
          });
        }
        sqlite.close();
        console.log(`Copied ${existingEmbeddings.length} embeddings from SQLite for article ${row.id}`);
        return;
      }
      sqlite.close();
    }
    console.log(`Computing new embeddings for article ${row.id}`);

    // 1. purge old vectors
    await tx.delete(embedding).where(eq(embedding.articleId, row.id));

    // 2. chunk markdown
    const chunks = await splitter.splitText(row.markdown);

    // 3. embed in batches of 50
    const BATCH = 50;
    const allEmbeddings: Array<{
      articleId: string;
      chunkIdx: number;
      content: string;
      embedding: number[];
      contentHash?: string;
    }> = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const resp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: slice,
      });
      const batch = resp.data as Array<{embedding: number[]}>;
      const chunkEmbeddings = batch.map((e, j) => ({
        articleId: row.id,
        chunkIdx: i + j,
        content: slice[j],
        embedding: e.embedding,
      }));
      await tx.insert(embedding).values(chunkEmbeddings);
      allEmbeddings.push(...chunkEmbeddings);
    }

    // 4. full-doc vector (chunkIdx = –1) with content hash
    const meta =
      `title:${row.title}\n${row.description}\ntags:${row.tags.join(',')}\n` +
      `created:${row.createdAt.toISOString()}\n` +
      `hash:${contentHash}`;
    const doc = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: meta,
    });
    const metaEmbedding = {
      articleId: row.id,
      chunkIdx: -1,
      content: meta,
      embedding: (doc.data as any)[0].embedding,
    };
    await tx.insert(embedding).values(metaEmbedding);
    allEmbeddings.push(metaEmbedding);
    if (sqliteTableExistsFlag) {
      const sqlite = getSqliteConnection();
      const sqliteDb = drizzleSQLite(sqlite);
      await sqliteDb.delete(notionEmbedding).where(eq(notionEmbedding.articleId, row.id));
      await sqliteDb.insert(notionEmbedding).values(
        allEmbeddings.map(e => ({
          articleId: e.articleId,
          chunkIdx: e.chunkIdx,
          content: e.content,
          embedding: e.embedding,
          contentHash: contentHash,
        }))
      );
      sqlite.close();
      console.log(`Stored ${allEmbeddings.length} embeddings in SQLite for article ${row.id}`);
    }
    console.log(`Embedded ${chunks.length} chunks for article ${row.id}`);
  });
}
