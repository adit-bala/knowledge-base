/**
 * Factory function to create a fully configured sync pipeline.
 */

import type {SyncPipelineConfig} from './config';
import {SyncPipeline} from './pipeline';
import {
  DownloadImagesStep,
  EmbedArticlesStep,
  ExportDatabaseStep,
  FetchNotionStep,
  StoreImagesStep,
  UpsertArticlesStep,
} from './steps';

/**
 * Create a fully configured sync pipeline.
 *
 * TypeScript enforces that config has all required fields:
 * - notion.token, notion.dbId (for FetchNotionStep)
 * - openai.apiKey (for EmbedArticlesStep)
 * - export.outputPath (for ExportDatabaseStep)
 */
export function createSyncPipeline(
  config: SyncPipelineConfig,
): SyncPipeline<SyncPipelineConfig> {
  const pipeline = new SyncPipeline(config);

  // Fetch phase
  pipeline.addStep(new FetchNotionStep());
  pipeline.addStep(new DownloadImagesStep());

  // Update phase
  pipeline.addStep(new UpsertArticlesStep());
  pipeline.addStep(new StoreImagesStep());
  pipeline.addStep(new EmbedArticlesStep());

  // Upload phase
  pipeline.addStep(new ExportDatabaseStep());

  return pipeline;
}
