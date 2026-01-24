/**
 * Core types for the sync pipeline.
 */

/** Phases of the sync pipeline */
export type Phase = 'fetch' | 'update' | 'upload';

/** Result of comparing fetched data with existing database */
export interface UpdatePlan<T> {
  toCreate: T[]; // New items not in DB
  toUpdate: T[]; // Items that changed
  toSkip: T[]; // Items unchanged (for logging)
  toDelete: string[]; // IDs in DB but not in fetched data
}

/** Fetched article with downloaded images */
export interface FetchedArticle {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: Date;
  lastEdited: Date;
  status: 'draft' | 'published' | 'archive' | 'in_review';
  markdown: string;
  /** Images downloaded from Notion, keyed by original URL */
  images: Map<string, {data: ArrayBuffer; mimeType: string}>;
}

/** Article ready for database insertion */
export interface ProcessedArticle extends Omit<FetchedArticle, 'images'> {
  /** Markdown with image URLs replaced with db:// references */
  markdown: string;
  /** Images to store in DB */
  images: Array<{
    id: string; // Generated UUID
    data: ArrayBuffer;
    mimeType: string;
    originalUrl: string;
  }>;
}

/** Step execution result */
export interface StepResult<T> {
  data: T;
  duration: number;
}

/** Summary of a step execution */
export interface StepSummary {
  name: string;
  duration: number;
  success: boolean;
}

/** Result of running a pipeline phase */
export interface PhaseResult {
  output: unknown;
  duration: number;
  steps: StepSummary[];
}

/** Full pipeline execution result */
export interface PipelineResult {
  success: boolean;
  totalDuration: number;
  phases: {
    fetch: {duration: number; steps: StepSummary[]};
    diff: {duration: number; plan: UpdatePlan<FetchedArticle>};
    update: {duration: number; steps: StepSummary[]};
    upload: {duration: number; steps: StepSummary[]};
  };
}
