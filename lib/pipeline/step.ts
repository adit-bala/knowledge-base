/**
 * Base class for pipeline steps.
 */

import type {PGliteDatabase} from '../db/pglite';
import type {Phase, StepResult} from './types';

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

/**
 * Execution context passed to steps.
 * No artifacts - data flows through step inputs/outputs.
 */
export interface StepContext<TConfig> {
  readonly config: TConfig;
  readonly logger: Logger;
  readonly db: PGliteDatabase;
}

/**
 * Base class for pipeline steps.
 *
 * @typeParam TInput - Input type from previous step
 * @typeParam TOutput - Output type for next step
 * @typeParam TConfig - Required configuration fields
 */
export abstract class PipelineStep<
  TInput = void,
  TOutput = void,
  TConfig = unknown,
> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly phase: Phase;

  protected ctx!: StepContext<TConfig>;

  /** Implement step logic here */
  protected abstract execute(input: TInput): Promise<TOutput>;

  /** Called by Pipeline - wraps execute with logging/timing */
  async run(
    input: TInput,
    ctx: StepContext<TConfig>,
  ): Promise<StepResult<TOutput>> {
    this.ctx = ctx;
    const start = performance.now();

    this.log('Starting...');
    try {
      const data = await this.execute(input);
      const duration = performance.now() - start;
      this.log(`Completed in ${duration.toFixed(0)}ms`);
      return {data, duration};
    } catch (error) {
      this.log(`Failed: ${error}`, 'error');
      throw error;
    }
  }

  protected log(
    message: string,
    level: 'info' | 'error' | 'debug' = 'info',
  ): void {
    this.ctx.logger[level](`[${this.name}] ${message}`);
  }

  protected get db(): PGliteDatabase {
    return this.ctx.db;
  }

  protected get config(): TConfig {
    return this.ctx.config;
  }
}
