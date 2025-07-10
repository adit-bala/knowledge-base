import {sqliteTable as table} from 'drizzle-orm/sqlite-core';
import * as t from 'drizzle-orm/sqlite-core';

export const notion = table('notion', {
  id: t.text('id').primaryKey(),
  title: t.text('title').notNull(),
  description: t.text('description').notNull(),
  tags: t.text('tags', {mode: 'json'}).notNull().$type<string[]>().default([]),
  createdAt: t.text('created_at').notNull(),
  markdown: t.text('markdown').notNull(),
  status: t.text('status').notNull(),
  lastEdited: t.text('last_edited').notNull(),
});

export const notionEmbedding = table('notion_embedding', {
  id: t.integer('id').primaryKey({autoIncrement: true}),
  articleId: t
    .text('article_id')
    .notNull()
    .references(() => notion.id),
  chunkIdx: t.integer('chunk_idx').notNull(),
  content: t.text('content').notNull(),
  embedding: t.text('embedding', {mode: 'json'}).notNull().$type<number[]>(),
  contentHash: t.text('content_hash').notNull(),
});
