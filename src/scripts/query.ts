import {getPgDrizzle, closePgPool} from '@db/db';
import {cosineDistance, desc, sql} from 'drizzle-orm';
import OpenAI from 'openai';
import readline from 'node:readline/promises';
import {config} from 'dotenv';

// Force reload environment variables
config({override: true});

import {embedding} from '@schema/embedding';

const db = getPgDrizzle({embedding});

let tokenizer: any | undefined;
let model: any | undefined;

async function loadCrossEncoder() {
  if (tokenizer && model) return;

  const {AutoTokenizer, AutoModelForSequenceClassification} = await import(
    '@xenova/transformers'
  );

  const MODEL_NAME = 'cross-encoder/ms-marco-MiniLM-L-6-v2';
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
  model = await AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, {
    quantized: false, // use full-precision weights
  });
}

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

async function rerank(
  query: string,
  rows: Array<{content: string; score: number}>,
): Promise<Array<{content: string; score: number; ceScore: number}>> {
  if (rows.length === 0) return [];

  await loadCrossEncoder();

  const scored = await Promise.all(
    rows.map(async r => {
      const inputs = tokenizer!(query, {
        text_pair: r.content,
        padding: true,
        truncation: true,
      });
      const {logits} = await model!(inputs);
      // logits is a Tensor; extract first value
      const ce = (logits.data as Float32Array)[0] as number;
      return {...r, ceScore: ce};
    }),
  );

  // Return top-5 by cross-encoder score
  const top5 = scored.sort((a, b) => b.ceScore - a.ceScore).slice(0, 5);
  return top5;
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

  // --------------------- Cross-encoder reranking --------------------------
  const reranked = await rerank(query, rows);

  console.log('\n--- Retrieved (after reranking) ---');
  reranked.forEach(
    (r: {score: number; ceScore: number; content: string}, i: number) => {
      console.log(
        `#${i + 1} (bi=${r.score.toFixed(4)}, ce=${r.ceScore.toFixed(4)})\n${r.content}\n`,
      );
    },
  );

  const context = reranked.map(r => r.content).join('\n---\n');
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
