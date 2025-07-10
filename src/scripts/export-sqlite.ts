import {drizzle as drizzleSQLite} from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import {db} from './db';
import {article} from '../schema/article';
import {notion} from '../schema/notion';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

async function main() {
  // Ensure db directory exists
  const dbDir = path.join(process.cwd(), 'db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {recursive: true});
  }

  // Connect to SQLite
  const sqlite = new Database('./db/notion.db');
  const sqliteDb = drizzleSQLite(sqlite);

  console.log('Fetching articles from PostgreSQL...');

  // Fetch all articles from PostgreSQL
  const articles = await db.select().from(article);

  console.log(`Found ${articles.length} articles to export`);

  // Clear existing data from SQLite notion table
  await sqliteDb.delete(notion);
  console.log('Cleared existing data from SQLite notion table');

  // Convert and insert articles
  const convertedArticles = articles.map(article => ({
    id: article.id,
    title: article.title,
    description: article.description,
    tags: article.tags,
    createdAt: article.createdAt.toISOString(),
    markdown: article.markdown,
    status: article.status || 'published',
    lastEdited: article.lastEdited.toISOString(),
  }));

  // Insert in batches to avoid memory issues
  const batchSize = 100;
  for (let i = 0; i < convertedArticles.length; i += batchSize) {
    const batch = convertedArticles.slice(i, i + batchSize);
    await sqliteDb.insert(notion).values(batch);
    console.log(
      `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
        convertedArticles.length / batchSize,
      )}`,
    );
  }

  console.log(
    `Successfully exported ${convertedArticles.length} articles to SQLite`,
  );

  // Close connections
  sqlite.close();
}

main().catch(console.error);
