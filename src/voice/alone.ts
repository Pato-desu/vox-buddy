export interface AloneOptions {
  /** Leave after this long with no humans in the channel. */
  afterMs: number;
  onLeave: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Counts down when the bot is the only one left in a voice channel; anyone coming back cancels it. */
export class AloneWatcher {
  private handle: unknown;
  private fired = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly o: AloneOptions) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Call whenever channel membership changes (and once after joining). */
  humansPresent(count: number): void {
    if (this.fired) return;
    if (count > 0) {
      this.stop();
    } else if (this.handle === undefined) {
      this.handle = this.setTimer(() => {
        this.handle = undefined;
        this.fired = true;
        this.o.onLeave();
      }, this.o.afterMs);
    }
  }

  /** Frees the timer (the bot left for another reason). */
  stop(): void {
    if (this.handle !== undefined) this.clearTimer(this.handle);
    this.handle = undefined;
  }
}
