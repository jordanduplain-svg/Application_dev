import type { Clock } from "../../ports/Clock.js";

/**
 * Implémentation par défaut du port Clock : utilise l'horloge système.
 *
 * À câbler dans la composition root (`main.ts`). En test, remplacer par un
 * FakeClock qui retourne un instant figé (cf. domain/exposure/__tests__).
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
