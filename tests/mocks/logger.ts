/**
 * Mock logger for testing.
 */

import type {Logger} from '../../lib/pipeline/step';

export interface LogEntry {
  level: 'info' | 'error' | 'debug';
  message: string;
  timestamp: Date;
}

/**
 * A mock logger that captures all log entries for testing.
 */
export class MockLogger implements Logger {
  entries: LogEntry[] = [];

  info(msg: string): void {
    this.entries.push({level: 'info', message: msg, timestamp: new Date()});
  }

  error(msg: string): void {
    this.entries.push({level: 'error', message: msg, timestamp: new Date()});
  }

  debug(msg: string): void {
    this.entries.push({level: 'debug', message: msg, timestamp: new Date()});
  }

  /**
   * Clear all log entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get all messages containing the given substring.
   */
  getMessagesContaining(substring: string): string[] {
    return this.entries
      .filter(e => e.message.includes(substring))
      .map(e => e.message);
  }

  /**
   * Get all error messages.
   */
  getErrors(): string[] {
    return this.entries.filter(e => e.level === 'error').map(e => e.message);
  }

  /**
   * Check if any message contains the given substring.
   */
  hasMessage(substring: string): boolean {
    return this.entries.some(e => e.message.includes(substring));
  }
}

/**
 * Create a silent logger that discards all output.
 */
export function createSilentLogger(): Logger {
  return {
    info: () => {},
    error: () => {},
    debug: () => {},
  };
}
