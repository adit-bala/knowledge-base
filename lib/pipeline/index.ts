/**
 * Pipeline module - re-exports all public APIs.
 */

// Types
export type {
  Phase,
  UpdatePlan,
  FetchedArticle,
  ProcessedArticle,
  StepResult,
  StepSummary,
  PipelineResult,
  PhaseResult,
} from './types';

// Config
export type {
  BaseConfig,
  NotionConfig,
  OpenAIConfig,
  ExportConfig,
  SyncPipelineConfig,
} from './config';

// Step base class
export {PipelineStep} from './step';
export type {Logger, StepContext} from './step';

// Diff resolver
export {TimestampDiffResolver} from './diff';
export type {DiffResolver} from './diff';

// Pipeline orchestrator
export {SyncPipeline} from './pipeline';

// Factory function
export {createSyncPipeline} from './sync-pipeline';

// Steps
export * from './steps';
