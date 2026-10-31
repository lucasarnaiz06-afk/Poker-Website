/** Sliding-window limit: at most `capacity` events in any `windowMs` window. */
export type WindowPolicy = { capacity: number; windowMs: number };

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  /** Longest window seen, so pruning never drops hits that still count (e.g. a 15-minute lockout). */
  private maxWindowMs = 60_000;

  constructor(private readonly now: () => number = Date.now) {}

  /** Records one event for `key`; false (nothing recorded) when the limit is reached. */
  take(key: string, policy: WindowPolicy): boolean {
    const now = this.now();
    if (policy.windowMs > this.maxWindowMs) this.maxWindowMs = policy.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < policy.windowMs);
    if (recent.length >= policy.capacity) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.prune(now);
    return true;
  }

  /** Removes the most recent event recorded for `key` (undo a probe). */
  untake(key: string) {
    this.hits.get(key)?.pop();
  }

  /** Forgets keys starting with `prefix` (e.g. a disconnected socket). */
  forget(prefix: string) {
    for (const key of this.hits.keys()) if (key.startsWith(prefix)) this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [key, list] of this.hits) if (list.every((at) => now - at > this.maxWindowMs)) this.hits.delete(key);
  }
}

export type RateLimitCategory = "any" | "join" | "action" | "seat" | "vote" | "chat" | "lobby";

export const DEFAULT_SOCKET_LIMITS: Record<RateLimitCategory, WindowPolicy> = {
  any: { capacity: 60, windowMs: 10_000 },
  join: { capacity: 10, windowMs: 10_000 },
  action: { capacity: 12, windowMs: 5_000 },
  seat: { capacity: 12, windowMs: 10_000 },
  vote: { capacity: 8, windowMs: 10_000 },
  chat: { capacity: 5, windowMs: 10_000 },
  lobby: { capacity: 6, windowMs: 10_000 },
};
