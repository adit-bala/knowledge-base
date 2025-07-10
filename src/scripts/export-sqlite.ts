import {drizzle as drizzleSQLite} from 'drizzle-orm/better-sqlite3';
import {pgDb, getSqliteConnection, ensureDbDir} from '@db/db';
import {article} from '@schema/article';
import {embedding} from '@schema/embedding';
import {notion, notionEmbedding} from '@schema/notion';
import 'dotenv/config';

async function main() {
  // Ensure db directory exists
  ensureDbDir();

  // Connect to SQLite
  const sqlite = getSqliteConnection();
  const sqliteDb = drizzleSQLite(sqlite);

  console.log('Fetching articles from PostgreSQL...');

  // Fetch all articles from PostgreSQL
  const articles = await pgDb.select().from(article);
  console.log(`Found ${articles.length} articles to export`);

  // Fetch all embeddings from PostgreSQL
  const embeddings = await pgDb.select().from(embedding);
  console.log(`Found ${embeddings.length} embeddings to export`);

  // Clear existing data from SQLite tables (embeddings first due to foreign key)
  await sqliteDb.delete(notionEmbedding);
  await sqliteDb.delete(notion);
  console.log('Cleared existing data from SQLite tables');

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

  // Convert and insert embeddings
  const convertedEmbeddings = embeddings.map(embedding => ({
    articleId: embedding.articleId,
    chunkIdx: embedding.chunkIdx,
    content: embedding.content,
    embedding: embedding.embedding,
    contentHash: '', // We'll need to generate this from content
  }));

  // Generate content hashes for embeddings
  const crypto = require('crypto');
  for (const emb of convertedEmbeddings) {
    emb.contentHash = crypto
      .createHash('md5')
      .update(emb.content)
      .digest('hex');
  }

  // Insert embeddings in batches
  const embeddingBatchSize = 100;
  for (let i = 0; i < convertedEmbeddings.length; i += embeddingBatchSize) {
    const batch = convertedEmbeddings.slice(i, i + embeddingBatchSize);
    await sqliteDb.insert(notionEmbedding).values(batch);
    console.log(
      `Inserted embedding batch ${Math.floor(i / embeddingBatchSize) + 1}/${Math.ceil(
        convertedEmbeddings.length / embeddingBatchSize,
      )}`,
    );
  }

  console.log(
    `Successfully exported ${convertedEmbeddings.length} embeddings to SQLite`,
  );

  // Close connections
  sqlite.close();
}

main().catch(console.error);
