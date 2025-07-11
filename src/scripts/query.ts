import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {cosineDistance, desc, sql} from 'drizzle-orm';
import OpenAI from 'openai';
import readline from 'node:readline/promises';
import 'dotenv/config';

import {embedding} from '@schema/embedding';

const pool = new Pool({connectionString: process.env.DATABASE_URL});
const db = drizzle(pool, {schema: {embedding}});

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

  const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY!});
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
    .limit(5);

  if (rows.length === 0) {
    // Fallback: just use vector similarity
    rows = await db
      .select({content: embedding.content, score: similarity})
      .from(embedding)
      .orderBy(desc(similarity))
      .limit(5);
  }

  console.log('\n--- Retrieved (before reranking) ---');
  rows.forEach((r, i) =>
    console.log(`#${i + 1} (${r.score.toFixed(4)})\n${r.content}\n`),
  );

  const context = rows.map(r => r.content).join('\n---\n');
  const chat = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {role: 'system', content: "You are Aditya's knowledge assistant."},
      {role: 'system', content: `Context:\n${context}`},
      {role: 'user', content: query},
    ],
  });

  console.log('--- Assistant ---\n' + chat.choices[0].message!.content);
  await pool.end();
}

main().catch(console.error);
