// KV-backed cache with TTL + jittered expiration.
// Open-source; reused across every Category 1 product.
//
// Pattern: every tool call computes a stable cache key (tool name + arg hash),
// checks KV for a cached value, returns it if present, otherwise calls the
// upstream public API and stores the result.
//
// Jitter prevents thundering-herd refresh when many cached entries share an
// upstream and would otherwise expire at the same instant.

export interface CachedValue<T> {
  v: T;
  exp: number;             // unix ms when this entry becomes stale
}

export class KvCache {
  constructor(private kv: KVNamespace, private prefix: string = "cache") {}

  async get<T>(key: string): Promise<T | null> {
    const wrapped = await this.kv.get<CachedValue<T>>(this.k(key), "json");
    if (!wrapped) return null;
    if (Date.now() > wrapped.exp) return null;
    return wrapped.v;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const jitterMs = Math.floor(Math.random() * 0.1 * ttlSeconds * 1000);
    const exp = Date.now() + ttlSeconds * 1000 + jitterMs;
    // KV expirationTtl is set slightly higher than logical exp so we keep the
    // value around even after it's logically stale (lets us do stale-while-revalidate
    // in future if needed).
    await this.kv.put(this.k(key), JSON.stringify({ v: value, exp }), {
      expirationTtl: Math.max(60, Math.floor(ttlSeconds * 1.5)),
    });
  }

  /** Cache wrapper around an async fn. */
  async memoize<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fn();
    // Don't await; let cache write happen in background (Workers waitUntil pattern).
    this.set(key, fresh, ttlSeconds).catch((e) => console.error("cache.set failed", e));
    return fresh;
  }

  private k(key: string): string {
    return `${this.prefix}:${key}`;
  }
}

/** Stable stringify for cache keys (object key order normalized). */
export function stableKey(parts: object | string): string {
  if (typeof parts === "string") return parts;
  const sorted = Object.keys(parts).sort();
  return sorted.map((k) => `${k}=${JSON.stringify((parts as any)[k])}`).join("&");
}
