import {sql} from 'drizzle-orm';
import {pgPolicy} from 'drizzle-orm/pg-core';
import {pgRole} from 'drizzle-orm/pg-core';
import {article} from './article.js';
import {embedding} from './embedding.js';

export const readOnlyRole = pgRole('read_only', {
  createRole: true,
});

// Read-only access policy for article
export const articleSelect = pgPolicy('article_select', {
  for: 'select',
  to: readOnlyRole,
  using: sql`true`,
}).link(article);

// Prevent writes to article
export const articleNoWrite = pgPolicy('article_no_write', {
  for: 'all',
  to: readOnlyRole,
  using: sql`false`,
  withCheck: sql`false`,
}).link(article);

// Read-only access for embedding
export const embeddingSelect = pgPolicy('embedding_select', {
  for: 'select',
  to: readOnlyRole,
  using: sql`true`,
}).link(embedding);

// Prevent writes to embedding
export const embeddingNoWrite = pgPolicy('embedding_no_write', {
  for: 'all',
  to: readOnlyRole,
  using: sql`false`,
  withCheck: sql`false`,
}).link(embedding);
