/**
 * Typed configuration for pipeline steps.
 * Each step declares its required config via generic constraints.
 */

import type {Logger} from './step';

/** Base configuration all pipelines need */
export interface BaseConfig {
  logger?: Logger;
  existingDbPath?: string; // Path to load existing DB from
}

/** Configuration required by Notion-related steps */
export interface NotionConfig {
  notion: {
    token: string;
    dbId: string;
    timeoutMs?: number;
  };
}

/** Configuration required by embedding steps */
export interface OpenAIConfig {
  openai: {
    apiKey: string;
    embeddingModel?: string; // defaults to 'text-embedding-3-small'
    chatModel?: string; // defaults to 'gpt-4o-mini'
  };
}

/** Configuration required by export steps */
export interface ExportConfig {
  export: {
    outputPath: string;
  };
}

/**
 * Full sync pipeline config - intersection of all required configs.
 * TypeScript enforces all fields are present when creating a SyncPipeline.
 */
export type SyncPipelineConfig = BaseConfig &
  NotionConfig &
  OpenAIConfig &
  ExportConfig;
