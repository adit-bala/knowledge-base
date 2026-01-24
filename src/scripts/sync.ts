/**
 * Sync script - runs the complete pipeline to sync Notion content to PGlite.
 */

import * as dotenv from 'dotenv';
import {createSyncPipeline} from '../../lib/pipeline';

dotenv.config();

async function main() {
  // Validate required environment variables
  const requiredEnvVars = ['NOTION_TOKEN', 'NOTION_DB_ID', 'OPENAI_API_KEY'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  const pipeline = createSyncPipeline({
    // Base config
    existingDbPath: './db/notion.db.tar.gz',
    logger: console,

    // Notion config (required by FetchNotionStep)
    notion: {
      token: process.env.NOTION_TOKEN!,
      dbId: process.env.NOTION_DB_ID!,
    },

    // OpenAI config (required by EmbedArticlesStep)
    openai: {
      apiKey: process.env.OPENAI_API_KEY!,
    },

    // Export config (required by ExportDatabaseStep)
    export: {
      outputPath: './db/notion.db.tar.gz',
    },
  });

  console.log('\n🚀 Starting sync pipeline...\n');

  const result = await pipeline.run();

  console.log('\n═══ PIPELINE COMPLETE ═══');
  console.log(`Total duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
  console.log('\nDiff summary:');
  console.log(`  - New: ${result.phases.diff.plan.toCreate.length}`);
  console.log(`  - Updated: ${result.phases.diff.plan.toUpdate.length}`);
  console.log(`  - Skipped: ${result.phases.diff.plan.toSkip.length}`);
  console.log(`  - Deleted: ${result.phases.diff.plan.toDelete.length}`);

  console.log('\nPhase breakdown:');
  console.log(
    `  - Fetch: ${(result.phases.fetch.duration / 1000).toFixed(2)}s`,
  );
  console.log(`  - Diff: ${(result.phases.diff.duration / 1000).toFixed(2)}s`);
  console.log(
    `  - Update: ${(result.phases.update.duration / 1000).toFixed(2)}s`,
  );
  console.log(
    `  - Upload: ${(result.phases.upload.duration / 1000).toFixed(2)}s`,
  );
}

main().catch(error => {
  console.error('Pipeline failed:', error);
  throw error;
});
