import {db} from './db';
import {Row} from '../../lib/notion/client';
import {embedding} from '../schema/embedding';
import {eq} from 'drizzle-orm';
import {RecursiveCharacterTextSplitter} from 'langchain/text_splitter';
import OpenAI from 'openai';
import 'dotenv/config';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1024,
  chunkOverlap: 200,
  separators: ['\n## ', '\n### ', '\n\n', '\n', ' '],
});
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY!});

export async function embedArticle(row: Row) {
  await db.transaction(async tx => {
    // 1. purge old vectors
    await tx.delete(embedding).where(eq(embedding.articleId, row.id));

    // 2. chunk markdown
    const chunks = await splitter.splitText(row.markdown);

    // 3. embed in batches of 50
    const BATCH = 50;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const resp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: slice,
      });
      const batch = resp.data as Array<{embedding: number[]}>;

      await tx.insert(embedding).values(
        batch.map((e, j) => ({
          articleId: row.id,
          chunkIdx: i + j,
          content: slice[j],
          embedding: e.embedding,
        })),
      );
    }

    // 4. full-doc vector (chunkIdx = –1)
    const meta =
      `title:${row.title}\n${row.description}\ntags:${row.tags.join(',')}\n` +
      `created:${row.createdAt.toISOString()}`;
    const doc = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: meta,
    });
    await tx.insert(embedding).values({
      articleId: row.id,
      chunkIdx: -1,
      content: meta,
      embedding: (doc.data as any)[0].embedding,
    });

    console.log(`Embedded ${chunks.length} chunks for article ${row.id}`);
  });
}
