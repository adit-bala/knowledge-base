import {getPgDrizzle, sqliteTableExists, withSqliteConnection} from '@db/db';
import {Row} from '@notion/client';
import {embedding} from '@schema/embedding';
import {eq, and, inArray} from 'drizzle-orm';
import {RecursiveCharacterTextSplitter} from 'langchain/text_splitter';
import OpenAI from 'openai';
import crypto from 'crypto';
import {drizzle as drizzleSQLite} from 'drizzle-orm/better-sqlite3';
import {notionEmbedding} from '@schema/notion';
import * as dotenv from 'dotenv';
dotenv.config({override: true});

const db = getPgDrizzle({embedding});

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
  await db.transaction(async tx => {
    const sqliteTableExistsFlag = sqliteTableExists('notion_embedding');
    if (sqliteTableExistsFlag) {
      console.log(
        'SQLite embedding table found - checking for cached embeddings',
      );
    } else {
      console.log(
        'SQLite embedding table not found - will compute new embeddings',
      );
    }

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
      contentHash: string;
    }> = [];

    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);

      // Check for existing embeddings for this batch
      if (sqliteTableExistsFlag) {
        const existingEmbeddings = await withSqliteConnection(async sqlite => {
          const sqliteDb = drizzleSQLite(sqlite);

          // Generate content hashes for this batch
          const batchContentHashes = slice.map(chunk =>
            generateContentHash(chunk),
          );

          // Check which chunks already exist
          return await sqliteDb
            .select()
            .from(notionEmbedding)
            .where(
              and(
                eq(notionEmbedding.articleId, row.id),
                inArray(notionEmbedding.contentHash, batchContentHashes),
              ),
            );
        });

        if (existingEmbeddings.length > 0) {
          console.log(
            `Found ${existingEmbeddings.length} existing embeddings for batch ${Math.floor(i / BATCH) + 1} - reusing from SQLite`,
          );

          // Copy existing embeddings to PostgreSQL
          for (const sqliteEmbedding of existingEmbeddings) {
            await tx.insert(embedding).values({
              articleId: sqliteEmbedding.articleId,
              chunkIdx: sqliteEmbedding.chunkIdx,
              content: sqliteEmbedding.content,
              embedding: sqliteEmbedding.embedding,
            });
            allEmbeddings.push({
              articleId: sqliteEmbedding.articleId,
              chunkIdx: sqliteEmbedding.chunkIdx,
              content: sqliteEmbedding.content,
              embedding: sqliteEmbedding.embedding,
              contentHash: sqliteEmbedding.contentHash,
            });
          }
        }
      }

      // Get embeddings for chunks that don't exist yet
      const existingContentHashes = allEmbeddings.map(e => e.contentHash);
      const newChunks = slice.filter((_, index) => {
        const chunkHash = generateContentHash(slice[index]);
        return !existingContentHashes.includes(chunkHash);
      });

      if (newChunks.length > 0) {
        console.log(
          `Computing ${newChunks.length} new embeddings for batch ${Math.floor(i / BATCH) + 1}`,
        );
        const resp = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: newChunks,
        });
        const batch = resp.data as Array<{embedding: number[]}>;

        // Find the indices of new chunks in the original slice
        const newChunkIndices = slice
          .map((chunk, index) => {
            const chunkHash = generateContentHash(chunk);
            return existingContentHashes.includes(chunkHash) ? -1 : index;
          })
          .filter(index => index !== -1);

        const newChunkEmbeddings = batch.map((e, j) => {
          const originalIndex = newChunkIndices[j];
          const chunkHash = generateContentHash(slice[originalIndex]);
          return {
            articleId: row.id,
            chunkIdx: i + originalIndex,
            content: slice[originalIndex],
            embedding: e.embedding,
            contentHash: chunkHash,
          };
        });

        await tx.insert(embedding).values(newChunkEmbeddings);
        allEmbeddings.push(...newChunkEmbeddings);
      }
    }
  });
}
