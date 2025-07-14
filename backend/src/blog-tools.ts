import {tool} from '@openai/agents';
import {z} from 'zod';
import OpenAI from 'openai';
import {article} from './schema/article.js';
import {embedding} from './schema/embedding.js';
import {sql, desc, cosineDistance} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import * as dotenv from 'dotenv';
import 'pgvector/pg';
dotenv.config({override: true});

export function createBlogTools(
  db: NodePgDatabase<{article: typeof article; embedding: typeof embedding}>,
  logger: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  },
) {
  const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY!});

  /* ------------------------------------------------------------------------ */
  /* 1. List all blog post titles + descriptions                              */
  /* ------------------------------------------------------------------------ */
  const listBlogPostTitlesAndDescriptionTool = tool({
    name: 'list_blog_post_titles_and_description',
    description: 'Get all blog post titles and descriptions from the database',
    parameters: z.object({}),
    async execute() {
      // RLS policies protect the table; no need to switch roles explicitly.
      logger.info('Executing listBlogPostTitlesAndDescriptionTool');
      try {
        const titles = await db
          .select({title: article.title, description: article.description})
          .from(article)
          .orderBy(article.title);

        if (titles.length === 0) {
          logger.info('No blog posts found in the database');
          return 'No blog posts found in the database.';
        }

        const titleList = titles
          .filter(
            item =>
              item.title !== 'About' &&
              item.title !== 'Contact' &&
              item.title !== 'CV',
          )
          .map(
            (item: {title: string; description: string}, index: number) =>
              `${index + 1}. blog post title: ${item.title}, blog post description: ${item.description}`,
          )
          .join('\n');
        logger.debug('Blog post titles:', titleList);
        return `Found ${titles.length} blog posts:\n\n${titleList}`;
      } catch (error) {
        logger.error('Error retrieving blog post titles:', error);
        return `Error retrieving blog post titles: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Raw SQL query tool                                                    */
  /* ------------------------------------------------------------------------ */
  const queryBlogDbSqlTool = tool({
    name: 'query_blog_db_sql',
    description: 'Run a SQL query on the blog database',
    parameters: z.object({
      sql_query: z.string().describe('The SQL query to execute'),
    }),
    async execute({sql_query}) {
      logger.info('Executing queryBlogDbSqlTool with query:', sql_query);

      // Validate query is a SELECT statement and safe
      const trimmedQuery = sql_query.trim();
      if (!/^select\s+/i.test(trimmedQuery)) {
        return 'Error: Only SELECT statements are allowed.';
      }
      if (/;\s*[^$]/.test(trimmedQuery)) {
        return 'Error: Multiple SQL statements are forbidden.';
      }

      try {
        // Use Drizzle to execute raw SELECT via its sql helper
        // Note: sql.raw is used for dynamic statements.
        const result = await db.execute(sql.raw(trimmedQuery));
        logger.debug('SQL query result:', result.rows ?? result);
        const rows = (result as any).rows ?? result;
        return `Query executed successfully. Found ${rows.length} rows:\n\n${JSON.stringify(rows, null, 2)}`;
      } catch (error) {
        logger.error('Error executing SQL query:', error);
        return `Error executing SQL query: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Natural-language semantic query tool                                  */
  /* ------------------------------------------------------------------------ */
  const queryBlogDbNaturalTool = tool({
    name: 'query_blog_db_natural',
    description:
      'Query the blog database using natural language. This will use RAG to find relevant content and provide context that can be used to answer the question.',
    parameters: z.object({
      natural_language_query: z
        .string()
        .describe(
          'The natural language query to search for in the blog content',
        ),
    }),
    async execute({natural_language_query}) {
      // RLS ensures read-only access; no explicit role switch needed.
      logger.info(
        'Executing queryBlogDbNaturalTool with query:',
        natural_language_query,
      );
      try {
        if (!natural_language_query.trim()) {
          logger.error('Empty query supplied to queryBlogDbNaturalTool');
          throw new Error('Empty query supplied');
        }

        // Generate embedding for the query
        const qVec = (
          await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: natural_language_query,
          })
        ).data[0].embedding as number[];

        // Full-text search condition
        const fullTextCondition = sql`to_tsvector('english', ${embedding.content}) @@ plainto_tsquery('english', ${natural_language_query})`;

        // Use Drizzle's cosineDistance helper with the query builder:
        const similarity = sql<number>`1 - (${cosineDistance(embedding.embedding, qVec)})`;
        let rows = await db
          .select({content: embedding.content, score: similarity})
          .from(embedding)
          .where(fullTextCondition)
          .orderBy(desc(similarity))
          .limit(5);
        logger.debug('RAG context:', rows);

        if (rows.length === 0) {
          // Fallback: just use vector similarity
          rows = await db
            .select({content: embedding.content, score: similarity})
            .from(embedding)
            .orderBy(desc(similarity))
            .limit(5);
        }

        if (rows.length === 0) {
          logger.info('No relevant content found for the query');
          return 'No relevant content found for your query.';
        }

        // Build context from retrieved content
        const context = rows
          .map((r: {content: string}) => r.content)
          .join('\n---\n');
        logger.debug('RAG context:', context);
        return context;
      } catch (error) {
        logger.error('Error processing natural language query:', error);
        return `Error processing natural language query: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });

  return [
    listBlogPostTitlesAndDescriptionTool,
    queryBlogDbSqlTool,
    queryBlogDbNaturalTool,
  ];
}
