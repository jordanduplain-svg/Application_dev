import { describe, expect, it } from "vitest";

import { createLoginRateLimiter } from "./loginRateLimiter.js";

describe("createLoginRateLimiter", () => {
  it("laisse passer jusqu'au quota puis refuse", () => {
    const limiter = createLoginRateLimiter(3, 60_000);
    const now = new Date("2026-01-01T00:00:00Z");
    expect(limiter.hit("ip", now)).toBe(false); // 1
    expect(limiter.hit("ip", now)).toBe(false); // 2
    expect(limiter.hit("ip", now)).toBe(false); // 3
    expect(limiter.hit("ip", now)).toBe(true); // 4 > 3 → refusé
  });

  it("réinitialise après la fenêtre", () => {
    const limiter = createLoginRateLimiter(1, 60_000);
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect(limiter.hit("ip", t0)).toBe(false);
    expect(limiter.hit("ip", t0)).toBe(true); // bloqué
    const t1 = new Date(t0.getTime() + 60_000);
    expect(limiter.hit("ip", t1)).toBe(false); // fenêtre suivante
  });

  it("isole les clés (IP) entre elles", () => {
    const limiter = createLoginRateLimiter(1, 60_000);
    const now = new Date("2026-01-01T00:00:00Z");
    expect(limiter.hit("a", now)).toBe(false);
    expect(limiter.hit("b", now)).toBe(false); // une autre IP n'est pas pénalisée
    expect(limiter.hit("a", now)).toBe(true);
  });
});
