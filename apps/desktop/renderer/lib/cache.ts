// PERF-S1 : cache local React avec TTL et invalidation manuelle.
const store = new Map<string, { data: unknown; ts: number }>();
const TTL_MS = 60_000; // 1 minute

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { store.delete(key); return null; }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() });
}

export function cacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheInvalidateAll(): void { store.clear(); }
