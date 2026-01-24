/**
 * Export database to file.
 */

import type {ExportConfig} from '../config';
import {PipelineStep} from '../step';

type Config = ExportConfig;

export class ExportDatabaseStep extends PipelineStep<void, Blob, Config> {
  readonly name = 'export-database';
  readonly description = 'Export database to file';
  readonly phase = 'upload' as const;

  protected async execute(): Promise<Blob> {
    const {outputPath} = this.config.export;

    await this.db.dumpToFile(outputPath);
    const blob = await this.db.dump();

    this.log(`Exported database to ${outputPath}`);
    return blob;
  }
}
