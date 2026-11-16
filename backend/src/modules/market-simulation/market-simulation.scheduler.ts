import {
  DEFAULT_MARKET_SIMULATION_INTERVAL_MS,
  MAX_MARKET_SIMULATION_INTERVAL_MS,
  MIN_MARKET_SIMULATION_INTERVAL_MS,
} from "./market-simulation.config";
import { MarketSimulationService } from "./market-simulation.service";
import {
  MarketSimulationError,
  MarketSimulationSchedulerStatus,
  MarketSimulationTickResult,
} from "./market-simulation.types";

export interface MarketSimulationSchedulerOptions {
  readonly service: MarketSimulationService;
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly unrefTimer?: boolean;
  readonly onTickCompleted?: (result: MarketSimulationTickResult) => void;
  readonly onTickError?: (err: unknown) => void;
}

/**
 * Controlled single-process scheduler for the Simulated Equity Market Engine.
 *
 * Architectural & Lifecycle Guarantees:
 * - Never starts automatically on module import.
 * - Starts only when `start()` is explicitly invoked and `enabled === true`.
 * - Uses sequential non-overlapping timeout scheduling so slow database ticks
 *   never overlap or race against each other.
 * - `stop()` immediately cancels the next scheduled timer and awaits any active
 *   in-flight tick to settle cleanly before resolving.
 * - Designed for a single local/development backend process; future multi-instance
 *   production deployments would use a dedicated worker process.
 */
export class MarketSimulationScheduler {
  private readonly service: MarketSimulationService;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly unrefTimer: boolean;
  private readonly onTickCompleted?: (result: MarketSimulationTickResult) => void;
  private readonly onTickError?: (err: unknown) => void;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private completedTicks = 0;
  private failedTicks = 0;
  private lastTickAt: Date | null = null;
  private lastTickUpdatedCount = 0;

  constructor(options: MarketSimulationSchedulerOptions) {
    if (!options || !options.service) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "MarketSimulationScheduler requires a valid MarketSimulationService instance."
      );
    }

    const intervalMs =
      options.intervalMs ?? DEFAULT_MARKET_SIMULATION_INTERVAL_MS;
    if (
      typeof intervalMs !== "number" ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < MIN_MARKET_SIMULATION_INTERVAL_MS ||
      intervalMs > MAX_MARKET_SIMULATION_INTERVAL_MS
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        `intervalMs must be an integer between ${MIN_MARKET_SIMULATION_INTERVAL_MS} and ${MAX_MARKET_SIMULATION_INTERVAL_MS}.`
      );
    }

    this.service = options.service;
    this.enabled = options.enabled ?? true;
    this.intervalMs = intervalMs;
    this.unrefTimer = options.unrefTimer ?? false;
    this.onTickCompleted = options.onTickCompleted;
    this.onTickError = options.onTickError;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getStatus(): MarketSimulationSchedulerStatus {
    const engine = this.service.getEngine();
    return Object.freeze({
      enabled: this.enabled,
      running: this.running,
      tickInProgress: this.service.isTickInProgress(),
      intervalMs: this.intervalMs,
      maxMoveBps: engine.getConfig().maxMoveBps,
      completedTicks: this.completedTicks,
      failedTicks: this.failedTicks,
      currentSentiment: engine.getCurrentSentiment(),
      lastTickAt: this.lastTickAt ? new Date(this.lastTickAt.getTime()) : null,
      lastTickUpdatedCount: this.lastTickUpdatedCount,
    });
  }

  /**
   * Starts the periodic simulation loop if `enabled` is true.
   * Idempotent: calling `start()` while already running is a safe no-op.
   */
  public start(): boolean {
    if (!this.enabled) {
      return false;
    }
    if (this.running) {
      return true;
    }

    this.running = true;
    this.scheduleNextTick();
    return true;
  }

  /**
   * Stops scheduling new ticks immediately and waits for any in-flight tick
   * to complete before resolving.
   */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.service.waitForActiveTick();
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const handle = setTimeout(async () => {
      this.timer = null;
      if (!this.running) {
        return;
      }

      try {
        const result = await this.service.executeTick();
        if (result.executed) {
          this.completedTicks += 1;
          this.lastTickAt = result.timestamp;
          this.lastTickUpdatedCount = result.updatedCount;
        }
        if (this.onTickCompleted) {
          this.onTickCompleted(result);
        }
      } catch (err: unknown) {
        this.failedTicks += 1;
        if (this.onTickError) {
          this.onTickError(err);
        }
      } finally {
        if (this.running) {
          this.scheduleNextTick();
        }
      }
    }, this.intervalMs);

    if (this.unrefTimer && typeof handle.unref === "function") {
      handle.unref();
    }

    this.timer = handle;
  }
}
