import {pgTable as table} from 'drizzle-orm/pg-core';
import {article} from './article.js';
import * as t from 'drizzle-orm/pg-core';

export const embedding = table(
  'embedding',
  {
    id: t.serial('id').primaryKey(),
    articleId: t
      .text('article_id')
      .notNull()
      .references(() => article.id),
    chunkIdx: t.integer('chunk_idx').notNull(),
    content: t.text('content').notNull(),
    embedding: t.vector('embedding', {dimensions: 1536}).notNull(),
  },
  table => [
    t
      .index('embeddingIndex')
      .using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
).enableRLS();
