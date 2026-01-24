/**
 * Three-phase pipeline orchestrator with diff resolution.
 */

import {PGliteDatabase} from '../db/pglite';
import {DiffResolver, TimestampDiffResolver} from './diff';
import type {PipelineStep, StepContext, Logger} from './step';
import type {FetchedArticle, StepSummary, PipelineResult} from './types';

const defaultLogger: Logger = {
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
  debug: (msg: string) => console.debug(msg),
};

/**
 * Three-phase pipeline with diff resolution between Fetch and Update.
 *
 * @typeParam TConfig - Configuration type (intersection of all step requirements)
 */
export class SyncPipeline<
  TConfig extends {existingDbPath?: string; logger?: Logger},
> {
  private fetchSteps: PipelineStep<unknown, unknown, TConfig>[] = [];
  private updateSteps: PipelineStep<unknown, unknown, TConfig>[] = [];
  private uploadSteps: PipelineStep<unknown, unknown, TConfig>[] = [];

  private db: PGliteDatabase | null = null;
  private diffResolver: DiffResolver;

  constructor(
    private readonly config: TConfig,
    diffResolver?: DiffResolver,
  ) {
    this.diffResolver = diffResolver ?? new TimestampDiffResolver();
  }

  /**
   * Add a step to the appropriate phase based on step.phase.
   * The step's config type must be a subset of the pipeline's config type.
   */
  addStep<TIn, TOut, TStepConfig>(
    step: TConfig extends TStepConfig
      ? PipelineStep<TIn, TOut, TStepConfig>
      : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = step as any as PipelineStep<unknown, unknown, TConfig>;
    switch (s.phase) {
      case 'fetch':
        this.fetchSteps.push(s);
        break;
      case 'update':
        this.updateSteps.push(s);
        break;
      case 'upload':
        this.uploadSteps.push(s);
        break;
    }
    return this;
  }

  /** Run the complete pipeline */
  async run(): Promise<PipelineResult> {
    const totalStart = performance.now();
    const logger = this.config.logger ?? defaultLogger;

    try {
      // FETCH PHASE - Retrieve data from external sources
      logger.info('═══ FETCH PHASE ═══');
      const fetchResult = await this.runPhase(this.fetchSteps, undefined);
      const fetchedArticles = fetchResult.output as FetchedArticle[];

      // DIFF RESOLUTION - Load existing DB and compute changes
      logger.info('═══ DIFF RESOLUTION ═══');
      const diffStart = performance.now();

      // Load existing database (or create empty one)
      this.db = await this.loadOrCreateDatabase();

      // Compute what changed
      const updatePlan = await this.diffResolver.resolve(
        fetchedArticles,
        this.db,
      );

      logger.info(
        `Diff complete: ${updatePlan.toCreate.length} new, ` +
          `${updatePlan.toUpdate.length} updated, ` +
          `${updatePlan.toSkip.length} unchanged, ` +
          `${updatePlan.toDelete.length} to delete`,
      );

      const diffDuration = performance.now() - diffStart;

      // UPDATE PHASE - Process only changed articles
      logger.info('═══ UPDATE PHASE ═══');
      const updateResult = await this.runPhase(this.updateSteps, updatePlan);

      // UPLOAD PHASE - Export and distribute
      logger.info('═══ UPLOAD PHASE ═══');
      const uploadResult = await this.runPhase(
        this.uploadSteps,
        updateResult.output,
      );

      return {
        success: true,
        totalDuration: performance.now() - totalStart,
        phases: {
          fetch: {duration: fetchResult.duration, steps: fetchResult.steps},
          diff: {duration: diffDuration, plan: updatePlan},
          update: {duration: updateResult.duration, steps: updateResult.steps},
          upload: {duration: uploadResult.duration, steps: uploadResult.steps},
        },
      };
    } catch (error) {
      logger.error(`Pipeline failed: ${error}`);
      throw error;
    } finally {
      await this.close();
    }
  }

  private async loadOrCreateDatabase(): Promise<PGliteDatabase> {
    const logger = this.config.logger ?? defaultLogger;

    if (this.config.existingDbPath) {
      try {
        logger.info('[Pipeline] Loading existing database...');
        return await PGliteDatabase.fromFile(this.config.existingDbPath);
      } catch {
        logger.info('[Pipeline] Could not load existing DB, creating new...');
      }
    }

    logger.info('[Pipeline] Creating new in-memory database...');
    const db = await PGliteDatabase.create();
    await db.initSchema();
    return db;
  }

  private async runPhase(
    steps: PipelineStep<unknown, unknown, TConfig>[],
    initialInput: unknown,
  ): Promise<{output: unknown; duration: number; steps: StepSummary[]}> {
    const start = performance.now();
    const stepSummaries: StepSummary[] = [];
    let currentInput = initialInput;

    const ctx: StepContext<TConfig> = {
      config: this.config,
      logger: this.config.logger ?? defaultLogger,
      db: this.db!,
    };

    for (const step of steps) {
      const result = await step.run(currentInput, ctx);
      stepSummaries.push({
        name: step.name,
        duration: result.duration,
        success: true,
      });
      currentInput = result.data;
    }

    return {
      output: currentInput,
      duration: performance.now() - start,
      steps: stepSummaries,
    };
  }

  async close(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }

  /** Get the database instance (for testing) */
  getDatabase(): PGliteDatabase | null {
    return this.db;
  }
}
