/**
 * Local stack only. A real Cloud Run cold start happens once, after an idle
 * period; delaying every request instead would make the waiting page reload
 * into another wait forever. State is per Worker isolate, which in
 * `wrangler dev` means one for the whole session.
 */
export class ColdStartSimulator {
  private lastWarmAt: number | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly idleMs: number,
  ) {}

  delayFor(now: number): number {
    if (this.delayMs <= 0) return 0;
    if (this.lastWarmAt !== null && now - this.lastWarmAt <= this.idleMs)
      return 0;

    return this.delayMs;
  }

  markWarm(now: number): void {
    this.lastWarmAt = now;
  }
}
