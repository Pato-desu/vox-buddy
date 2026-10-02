export interface MirrorOptions {
  /** Sends one message to the mirror channel. */
  post: (text: string) => Promise<void>;
  /** At most one message per this interval (Discord rate limits, and chat noise). Default 4 s. */
  minIntervalMs?: number;
  /** Lines waiting beyond this are dropped, oldest first. Default 20. */
  maxQueued?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  onError?: (e: Error) => void;
}

/**
 * Optional transcript mirror (D10): posts "heard / said" lines to a text channel. Lines are batched into one
 * message per interval so a busy call can't flood the channel or trip rate limits.
 */
export class TranscriptMirror {
  private queue: string[] = [];
  private lastSent = -Infinity;
  private timer: unknown;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  constructor(private readonly o: MirrorOptions) {
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  turn(speaker: string, heard: string, said: string): void {
    this.queue.push(`**${speaker}:** ${heard}\n**Buddy:** ${said}`);
    const max = this.o.maxQueued ?? 20;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    this.schedule();
  }

  get pending(): number {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    const wait = Math.max(0, this.lastSent + (this.o.minIntervalMs ?? 4000) - this.now());
    this.timer = this.setTimer(() => void this.flush(), wait);
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    if (this.queue.length === 0) return;
    // One message up to Discord's 2000-character limit; the rest waits for the next slot.
    let text = '';
    while (this.queue.length > 0 && text.length + this.queue[0]!.length + 2 <= 1900) text += (text ? '\n\n' : '') + this.queue.shift()!;
    if (!text) text = this.queue.shift()!.slice(0, 1900);
    this.lastSent = this.now();
    try {
      await this.o.post(text);
    } catch (e) {
      this.o.onError?.(e as Error); // a failed post never breaks the call
    }
    if (this.queue.length > 0) this.schedule();
  }
}
