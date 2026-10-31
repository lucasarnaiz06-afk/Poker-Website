/** Injectable time source so every table timer is deterministic in tests. */
export type TimerHandle = { readonly id: number };

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle | null | undefined): void;
}

let nextSystemTimerId = 1;
const systemTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(callback, ms) {
    const id = nextSystemTimerId++;
    const timer = setTimeout(() => {
      systemTimers.delete(id);
      callback();
    }, Math.max(0, ms));
    systemTimers.set(id, timer);
    return { id };
  },
  clearTimeout(handle) {
    if (!handle) return;
    const timer = systemTimers.get(handle.id);
    if (timer) clearTimeout(timer);
    systemTimers.delete(handle.id);
  },
};

type ManualTimer = { id: number; at: number; callback: () => void };

/**
 * Test clock: time only moves through `advance`. Timer callbacks fire in due order; after each one
 * `settle` is awaited so work the callback queued (e.g. a table command) finishes before the next timer.
 */
export class ManualClock implements Clock {
  private current: number;
  private timers: ManualTimer[] = [];
  private nextId = 1;

  constructor(start = Date.UTC(2026, 0, 1, 12, 0, 0)) {
    this.current = start;
  }

  now() {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const timer = { id: this.nextId++, at: this.current + Math.max(0, ms), callback };
    this.timers.push(timer);
    return { id: timer.id };
  }

  clearTimeout(handle: TimerHandle | null | undefined) {
    if (!handle) return;
    this.timers = this.timers.filter((timer) => timer.id !== handle.id);
  }

  pending() {
    return this.timers.length;
  }

  /** Moves time forward by `ms`, firing due timers in order. */
  async advance(ms: number, settle: () => Promise<void> = async () => undefined) {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.current = Math.max(this.current, due.at);
      due.callback();
      await settle();
    }
    this.current = target;
    await settle();
  }
}
