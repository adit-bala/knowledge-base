import {getPgDrizzle, closePgPool} from '@db/db';
import {cosineDistance, desc, sql} from 'drizzle-orm';
import OpenAI from 'openai';
import {CohereClientV2} from 'cohere-ai';
import readline from 'node:readline/promises';
import {config} from 'dotenv';

// Force reload environment variables
config({override: true});

const cohere = new CohereClientV2({});

import {embedding} from '@schema/embedding';

const db = getPgDrizzle({embedding});

async function ask(): Promise<string> {
  if (!process.stdin.isTTY) {
    let buf = '';
    for await (const c of process.stdin) buf += c;
    return buf.trim();
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const q = await rl.question('Enter your query: ');
  rl.close();
  return q.trim();
}

async function main() {
  const query = await ask();
  if (!query) throw new Error('Empty query');

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    organization: process.env.OPENAI_ORG_ID,
  });
  const qVec = (
    await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
  ).data[0].embedding as number[];

  // full text search
  const fullTextCondition = sql`to_tsvector('english', ${embedding.content}) @@ plainto_tsquery('english', ${query})`;

  // Use Drizzle's cosineDistance helper with the query builder:
  const similarity = sql<number>`1 - (${cosineDistance(embedding.embedding, qVec)})`;
  let rows = await db
    .select({content: embedding.content, score: similarity})
    .from(embedding)
    .where(fullTextCondition)
    .orderBy(desc(similarity))
    .limit(12);

  if (rows.length === 0) {
    // Fallback: just use vector similarity
    rows = await db
      .select({content: embedding.content, score: similarity})
      .from(embedding)
      .orderBy(desc(similarity))
      .limit(12);
  }

  console.log('\n--- Retrieved (before reranking) ---');
  rows.forEach((r, i) =>
    console.log(`#${i + 1} (${r.score.toFixed(4)})\n${r.content}\n`),
  );

  // Rerank with Cohere
  let rerankedResults = [];
  try {
    const reranked = await cohere.rerank({
      model: 'rerank-v3.5',
      documents: rows.map(r => r.content),
      query: query,
      topN: 5,
    });
    rerankedResults = reranked.results;
  } catch (error) {
    console.log('\n--- Error during reranking, using original results ---');
    console.error('Reranking error:', error);
    rerankedResults = rows.slice(0, 5).map((r, i) => ({
      index: i,
      document: {text: r.content},
      relevanceScore: r.score,
    }));
  }

  console.log('\n--- Retrieved (after reranking) ---');
  rerankedResults.forEach((r, i) => {
    // The rerank result only contains index and relevanceScore
    // We need to get the actual content from the original rows using the index
    const originalIndex = r.index;
    const content = rows[originalIndex]?.content || 'No content';
    console.log(
      `#${i + 1} (score: ${r.relevanceScore?.toFixed(4)})\n${content}\n`,
    );
  });

  const context = rerankedResults
    .map(r => {
      // Get the actual content from the original rows using the index
      const originalIndex = r.index;
      return rows[originalIndex]?.content || '';
    })
    .join('\n---\n');
  const chat = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {role: 'system', content: "You are Aditya's knowledge assistant."},
      {role: 'system', content: `Context:\n${context}`},
      {role: 'user', content: query},
    ],
  });

  console.log('--- Assistant ---\n' + chat.choices[0].message!.content);
}

main()
  .catch(console.error)
  .finally(() => closePgPool());
