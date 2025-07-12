import {Agent} from '@openai/agents';
import {createBlogTools} from '../blog-tools.js';
import 'dotenv/config';
import {article} from '../schema/article.js';
import {embedding} from '../schema/embedding.js';
import {inArray} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

// In-memory cache for article titles and content
const articleContentCache = new Map<string, string>();

// Top-level helper functions
function stringifyArticleContentCache(): string {
  if (articleContentCache.size === 0) {
    return '[Article content cache is empty, please initialize first.]';
  }
  return Array.from(articleContentCache.keys())
    .map(title => `${title}: ${articleContentCache.get(title)}`)
    .join('\n\n');
}

function getSchemaDocumentation(): string {
  return `Database Schema Information:

Article Table Structure:
- id (text, primary key): Notion page ID
- title (text, not null): Article title
- description (text, not null): Article description
- tags (text array, not null): Array of tags associated with the article
- created_at (timestamp, not null): When the article was created
- markdown (text, not null): The full markdown content of the article
- status (enum, nullable): Article status - can be 'draft', 'published', 'archive', or 'in_review'
- last_edited (timestamp, not null): When the article was last edited

Status Enum Values:
- draft: Article is in draft state
- published: Article is published and publicly available
- archive: Article is archived
- in_review: Article is under review

This schema allows you to understand the structure of the blog database and what information is available for querying.`;
}

function getDefaultInstructions(): string {
  return `
    You are an agent in charge of answering questions about Aditya. Here is some information about him:

    ${stringifyArticleContentCache()}

    There a number of information sources that you should always use to answer questions. Aditya has written a number of blog posts that cover a wide range of topics. You can use the list_blog_post_titles_and_description tool to get a list of all blog post titles and descriptions of the blog posts. You can also use the query_blog_db_sql tool to run SQL queries on the blog database. You can also use the query_blog_db_natural tool to query the blog database using natural language, which will use RAG to find relevant content and provide context that can be used to answer the question.

  Here is the database schema:
  ${getSchemaDocumentation()}

  Use these tools to help answer questions about the blog content. When users ask questions, use the appropriate tool(s) to find relevant information and answer the question. once you have sufficient information
  
  Ensure your response is concise and to the point, but is very friendly and engaging.`;
}

// Exported cache initializer
export async function initializeArticleContentCacheWithLog(
  db: NodePgDatabase<{article: typeof article; embedding: typeof embedding}>,
  logger: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  } = console,
) {
  if (articleContentCache.size > 0) {
    logger.info('Article content cache already initialized');
    return;
  }
  logger.info('Initializing article content cache');
  try {
    const articles = await db
      .select({title: article.title, markdown: article.markdown})
      .from(article)
      .where(inArray(article.title, ['About', 'Contact', 'CV']))
      .orderBy(article.title);
    articleContentCache.clear();
    articles.forEach((item: {title: string; markdown: string}) => {
      logger.debug('Caching article:', item.title);
      articleContentCache.set(item.title, item.markdown);
    });
    logger.info(
      `Initialized article content cache with: ${Array.from(articleContentCache.keys()).join(', ')}`,
    );
  } catch (error) {
    logger.error('Failed to initialize article content cache:', error);
  }
}

// Exported system prompt getter
export function getSystemPrompt(): string {
  return getDefaultInstructions();
}

// Factory function to create the knowledge agent
export function createKnowledgeAgent(
  db: NodePgDatabase<{article: typeof article; embedding: typeof embedding}>,
  logger: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  },
  systemPrompt: string,
) {
  return new Agent({
    name: 'knowledge-base-assistant',
    instructions: systemPrompt,
    tools: createBlogTools(db, logger),
  });
}
