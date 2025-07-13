import {logger} from './logger.js';

interface RateLimitState {
  currentDay: string;
  usedToday: number;
  carriedOver: number;
  lastReset: string;
}

export class RateLimiter {
  private state: RateLimitState;
  private readonly maxDaily: number;
  private readonly carryoverRate: number;

  constructor(maxDaily = 50, carryoverRate = 0.5) {
    this.maxDaily = maxDaily;
    this.carryoverRate = carryoverRate;
    this.state = {
      currentDay: this.getCurrentDay(),
      usedToday: 0,
      carriedOver: 0,
      lastReset: new Date().toISOString(),
    };
  }

  private getCurrentDay(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  private shouldReset(): boolean {
    const today = this.getCurrentDay();
    return today !== this.state.currentDay;
  }

  private resetDaily(): void {
    const previousDay = this.state.currentDay;
    const today = this.getCurrentDay();

    // Calculate carryover from previous day
    const unusedFromYesterday = Math.max(
      0,
      this.maxDaily - this.state.usedToday,
    );
    const newCarryover = Math.floor(unusedFromYesterday * this.carryoverRate);

    logger.info(
      {
        previousDay,
        usedYesterday: this.state.usedToday,
        unusedFromYesterday,
        newCarryover,
        previousCarryover: this.state.carriedOver,
      },
      'Resetting daily rate limit with carryover',
    );

    this.state = {
      currentDay: today,
      usedToday: 0,
      carriedOver: this.state.carriedOver + newCarryover,
      lastReset: new Date().toISOString(),
    };
  }

  public checkLimit(): {
    allowed: boolean;
    remaining: number;
    resetTime: string;
  } {
    if (this.shouldReset()) {
      this.resetDaily();
    }

    const totalAvailable = this.maxDaily + this.state.carriedOver;
    const remaining = Math.max(0, totalAvailable - this.state.usedToday);
    const allowed = remaining > 0;

    return {
      allowed,
      remaining,
      resetTime: this.getNextResetTime(),
    };
  }

  public incrementUsage(): void {
    if (this.shouldReset()) {
      this.resetDaily();
    }

    this.state.usedToday++;

    logger.info(
      {
        usedToday: this.state.usedToday,
        carriedOver: this.state.carriedOver,
        totalAvailable: this.maxDaily + this.state.carriedOver,
        remaining: Math.max(
          0,
          this.maxDaily + this.state.carriedOver - this.state.usedToday,
        ),
      },
      'Rate limit usage incremented',
    );
  }

  private getNextResetTime(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  public getStatus(): RateLimitState & {
    totalAvailable: number;
    remaining: number;
  } {
    if (this.shouldReset()) {
      this.resetDaily();
    }

    const totalAvailable = this.maxDaily + this.state.carriedOver;
    const remaining = Math.max(0, totalAvailable - this.state.usedToday);

    return {
      ...this.state,
      totalAvailable,
      remaining,
    };
  }
}

// Create a singleton instance
export const rateLimiter = new RateLimiter();
