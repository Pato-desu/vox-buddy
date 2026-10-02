import { EventEmitter } from 'node:events';
import type { AudioChunk, Player } from '../pipeline/types.js';

/** Plays one chunk; resolves when it ends or is stopped. The real one wraps @discordjs/voice's AudioPlayer. */
export interface ChunkSink {
  play(chunk: AudioChunk): Promise<void>;
  stop(): void;
}

export interface PlaybackEvents {
  start: [chunk: AudioChunk];
  end: [chunk: AudioChunk];
  /** The queue ran dry: the bot stopped talking. */
  idle: [];
}

/** In-order playback queue with stop(). */
export class PlaybackQueue extends EventEmitter<PlaybackEvents> implements Player {
  private queue: AudioChunk[] = [];
  private running = false;
  private generation = 0;

  constructor(private readonly sink: ChunkSink) {
    super();
  }

  get playing(): boolean {
    return this.running;
  }

  get pending(): number {
    return this.queue.length;
  }

  whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.once('idle', () => resolve()));
  }

  enqueue(chunk: AudioChunk): void {
    this.queue.push(chunk);
    if (!this.running) void this.drain();
  }

  /** Drops queued chunks; the one playing finishes. */
  dropPending(): void {
    this.queue = [];
  }

  /** Stops the current chunk and drops everything queued. */
  stop(): void {
    this.generation++;
    this.queue = [];
    if (this.running) this.sink.stop();
  }

  private async drain(): Promise<void> {
    this.running = true;
    const gen = this.generation;
    try {
      while (this.queue.length > 0 && gen === this.generation) {
        const chunk = this.queue.shift()!;
        this.emit('start', chunk);
        try {
          await this.sink.play(chunk);
        } finally {
          this.emit('end', chunk);
        }
      }
    } catch {
      this.queue = []; // a failed sink must not wedge the queue
    } finally {
      if (gen === this.generation) {
        this.running = false;
        this.emit('idle');
      } else if (this.queue.length > 0) {
        void this.drain(); // chunks arrived after stop(); run them under the new generation
      } else {
        this.running = false;
        this.emit('idle');
      }
    }
  }
}
