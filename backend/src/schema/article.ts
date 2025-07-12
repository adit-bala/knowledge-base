import {sql} from 'drizzle-orm';
import {pgEnum, pgTable as table, pgRole} from 'drizzle-orm/pg-core';
import * as t from 'drizzle-orm/pg-core';

export const rolesEnum = pgEnum('status', [
  'draft',
  'published',
  'archive',
  'in_review',
]);

export const readOnlyRole = pgRole('read_only');

export const article = table('article', {
  id: t.text('id').primaryKey(), // notion page id
  title: t.text('title').notNull(),
  description: t.text('description').notNull(),
  tags: t
    .text('tags')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: t.timestamp('created_at').notNull(),
  markdown: t.text('markdown').notNull(),
  status: rolesEnum('status'),
  lastEdited: t.timestamp('last_edited').notNull(),
}).enableRLS();
