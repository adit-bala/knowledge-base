/**
 * Interactive query script for PGlite database.
 * Supports both RAG queries and raw SQL.
 */

import * as dotenv from 'dotenv';
import * as readline from 'node:readline/promises';
import OpenAI from 'openai';
import {PGliteDatabase} from '../../lib/db/pglite';

dotenv.config();

const DB_PATH = './db/notion.db.tar.gz';

async function main() {
  console.log('Loading database...');
  const db = await PGliteDatabase.fromFile(DB_PATH);
  console.log('Database loaded!\n');

  const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Commands:');
  console.log('  /ask <question>  - Find top 5 articles using hybrid search');
  console.log('  /sql <query>     - Run raw SQL');
  console.log('  /articles        - List all articles');
  console.log('  /stats           - Show database stats');
  console.log('  /quit            - Exit');
  console.log('  <text>           - RAG search with AI answer\n');

  let running = true;
  while (running) {
    const input = await rl.question('> ');
    if (!input.trim()) continue;

    try {
      if (input.startsWith('/quit')) {
        running = false;
        continue;
      } else if (input.startsWith('/ask ')) {
        // Hybrid search - returns top 5 articles without AI answer
        const question = input.slice(5).trim();
        if (!question) {
          console.log('Usage: /ask <question>');
          continue;
        }

        // Generate embedding for query
        const embResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: question,
        });
        const queryVec = embResponse.data[0].embedding;

        // Hybrid search: combine vector similarity with full-text search
        const rows = await db.query<{
          id: string;
          title: string;
          description: string;
          tags: string[];
          vector_score: number;
          fts_score: number;
          combined_score: number;
        }>(
          `
          WITH vector_search AS (
            SELECT
              a.id,
              a.title,
              a.description,
              a.tags,
              1 - (e.embedding <=> $1::vector) as vector_score
            FROM embedding e
            JOIN article a ON e.article_id = a.id
          ),
          fts_search AS (
            SELECT
              a.id,
              ts_rank(to_tsvector('english', e.content), plainto_tsquery('english', $2)) as fts_score
            FROM embedding e
            JOIN article a ON e.article_id = a.id
            WHERE to_tsvector('english', e.content) @@ plainto_tsquery('english', $2)
          )
          SELECT
            v.id,
            v.title,
            v.description,
            v.tags,
            v.vector_score,
            COALESCE(f.fts_score, 0) as fts_score,
            (v.vector_score * 0.7 + COALESCE(f.fts_score, 0) * 0.3) as combined_score
          FROM vector_search v
          LEFT JOIN fts_search f ON v.id = f.id
          ORDER BY combined_score DESC
          LIMIT 5
        `,
          [JSON.stringify(queryVec), question],
        );

        if (rows.length === 0) {
          console.log('No articles found.');
          continue;
        }

        console.log(`\n📚 Top 5 articles for: "${question}"\n`);
        rows.forEach((r, i) => {
          const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
          console.log(
            `${i + 1}. ${r.title}${tags} (score: ${r.combined_score.toFixed(3)})`,
          );
          if (r.description) {
            console.log(
              `   ${r.description.slice(0, 100)}${r.description.length > 100 ? '...' : ''}`,
            );
          }
        });
        console.log();
      } else if (input.startsWith('/sql ')) {
        const sql = input.slice(5);
        const rows = await db.query(sql);
        console.log(JSON.stringify(rows, null, 2));
      } else if (input.startsWith('/articles')) {
        const rows = await db.query<{
          id: string;
          title: string;
          tags: string[];
        }>('SELECT id, title, tags FROM article ORDER BY last_edited DESC');
        rows.forEach((r, i) => {
          console.log(`${i + 1}. ${r.title} [${r.tags.join(', ')}]`);
        });
      } else if (input.startsWith('/stats')) {
        const articles = await db.query<{count: string}>(
          'SELECT COUNT(*) as count FROM article',
        );
        const embeddings = await db.query<{count: string}>(
          'SELECT COUNT(*) as count FROM embedding',
        );
        const images = await db.query<{count: string}>(
          'SELECT COUNT(*) as count FROM image',
        );
        console.log(`Articles: ${articles[0].count}`);
        console.log(`Embeddings: ${embeddings[0].count}`);
        console.log(`Images: ${images[0].count}`);
      } else {
        // RAG search with AI answer
        const query = input.trim();

        // Generate embedding for query
        const embResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: query,
        });
        const queryVec = embResponse.data[0].embedding;

        // Vector similarity search
        const rows = await db.query<{
          title: string;
          content: string;
          score: number;
        }>(
          `
          SELECT
            a.title,
            e.content,
            1 - (e.embedding <=> $1::vector) as score
          FROM embedding e
          JOIN article a ON e.article_id = a.id
          ORDER BY e.embedding <=> $1::vector
          LIMIT 5
        `,
          [JSON.stringify(queryVec)],
        );

        if (rows.length === 0) {
          console.log('No results found.');
          continue;
        }

        console.log('\n--- Top Results ---');
        rows.forEach((r, i) => {
          console.log(
            `\n#${i + 1} [${r.title}] (score: ${r.score.toFixed(4)})`,
          );
          console.log(r.content.slice(0, 200) + '...');
        });

        // Generate answer
        const context = rows.map(r => r.content).join('\n---\n');
        const chat = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {role: 'system', content: "You are Aditya's knowledge assistant."},
            {role: 'system', content: `Context:\n${context}`},
            {role: 'user', content: query},
          ],
        });

        console.log('\n--- Answer ---');
        console.log(chat.choices[0].message?.content);
        console.log();
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
  }

  rl.close();
  await db.close();
  console.log('Goodbye!');
}

main().catch(console.error);
