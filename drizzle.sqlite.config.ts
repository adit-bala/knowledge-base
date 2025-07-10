import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema',
  out: './drizzle-sqlite',
  dbCredentials: {
    url: './db/notion.db',
  },
});
