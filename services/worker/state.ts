import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';

/** A counted pool. Claims are sized by free slots, so the worker never takes work it cannot run. */
export interface SlotPool {
  readonly total: number;
  free(): number;
  take(count: number): void;
  release(count: number): void;
}

export function slotPool(total: number): SlotPool {
  let used = 0;
  return {
    total,
    free: () => Math.max(0, total - used),
    take: (count) => {
      used = Math.min(total, used + count);
    },
    release: (count) => {
      used = Math.max(0, used - count);
    },
  };
}

export function boundedSetting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export interface WorkerRuntime {
  workerId: string;
  api: OpenAI;
  jobSlots: SlotPool;
  monitorSlots: SlotPool;
  monitors: Map<string, AbortController>;
  maxRuntimeMs: number;
  stopping: boolean;
  pulling: boolean;
  pullAgain: boolean;
  lastClaimAt: number;
  lastSubscriptionAt: number;
  /** Whether the Convex subscription is live. Health reports it; nothing else depends on it. */
  connected: () => boolean;
}

export function createRuntime(api: OpenAI, connected: () => boolean): WorkerRuntime {
  return {
    workerId: randomUUID(),
    api,
    jobSlots: slotPool(boundedSetting('WORKER_CONCURRENCY', 4, 1, 16)),
    monitorSlots: slotPool(boundedSetting('WORKER_MONITORS', 16, 1, 64)),
    monitors: new Map(),
    maxRuntimeMs: boundedSetting('MAX_TURN_SECONDS', 900, 60, 3600) * 1000,
    stopping: false,
    pulling: false,
    pullAgain: false,
    lastClaimAt: 0,
    lastSubscriptionAt: 0,
    connected,
  };
}
