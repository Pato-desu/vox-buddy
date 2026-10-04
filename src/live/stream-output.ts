import { AudioPlayerStatus, StreamType, createAudioPlayer, createAudioResource, type AudioPlayer } from '@discordjs/voice';
import { Readable } from 'node:stream';
import { toDiscordPcm } from '../voice/discord-sink.js';
import type { LiveOutput } from './types.js';

export const LIVE_OUTPUT_RATE = 24000;

/** Plays one reply stream. Resolves when it has played to its end or been stopped. */
export interface StreamSink {
  play(stream: Readable): Promise<void>;
  stop(): void;
}

/**
 * Turns the reply's audio chunks into one continuous stream. It holds back the first `prebufferMs` so a slow network
 * does not make the start stutter, then plays straight through to the end of the reply.
 */
export class StreamOutput implements LiveOutput {
  private stream: Readable | null = null;
  private held: Buffer[] = [];
  private heldBytes = 0;
  private started = false;
  private ended = false;
  private waiters: (() => void)[] = [];
  private generation = 0;
  private readonly prebufferBytes: number;

  constructor(
    private readonly sink: StreamSink,
    prebufferMs = 250,
  ) {
    this.prebufferBytes = Math.floor((prebufferMs / 1000) * 48000) * 4; // 48 kHz stereo s16 = 4 bytes per frame
  }

  get playing(): boolean {
    return this.started || this.held.length > 0;
  }

  push(pcm: Int16Array): void {
    if (this.ended) this.reset(); // audio after end() starts a new reply
    const buf = toDiscordPcm({ pcm, sampleRate: LIVE_OUTPUT_RATE });
    if (this.stream) return void this.stream.push(buf);
    this.held.push(buf);
    this.heldBytes += buf.length;
    if (this.heldBytes >= this.prebufferBytes) this.start();
  }

  end(): void {
    if (this.held.length > 0 && !this.stream) this.start();
    this.ended = true;
    this.stream?.push(null);
  }

  stop(): void {
    this.generation++;
    this.sink.stop();
    this.stream?.destroy();
    this.reset();
    this.release();
  }

  whenIdle(): Promise<void> {
    return this.playing ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve();
  }

  private reset(): void {
    this.stream = null;
    this.held = [];
    this.heldBytes = 0;
    this.started = false;
    this.ended = false;
  }

  private release(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  private start(): void {
    const gen = this.generation;
    const stream = new Readable({ read() {} });
    this.stream = stream;
    this.started = true;
    for (const b of this.held) stream.push(b);
    this.held = [];
    this.heldBytes = 0;
    const finished = (): void => {
      if (gen !== this.generation || this.stream !== stream) return; // stopped or replaced meanwhile
      this.reset();
      this.release();
    };
    this.sink.play(stream).then(finished, finished);
  }
}

/** StreamSink over a @discordjs/voice AudioPlayer. Subscribe `player` to the connection elsewhere. */
export class DiscordStreamSink implements StreamSink {
  // Replies arrive in bursts; a late chunk must not make the player give up on the stream (default is 5 missed frames).
  readonly player: AudioPlayer = createAudioPlayer({ behaviors: { maxMissedFrames: 250 } });

  play(stream: Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.player.off('stateChange', onState);
        this.player.off('error', onError);
      };
      const onState = (_o: unknown, n: { status: AudioPlayerStatus }): void => {
        if (n.status !== AudioPlayerStatus.Idle) return;
        cleanup();
        resolve();
      };
      const onError = (e: Error): void => {
        cleanup();
        reject(e);
      };
      this.player.on('stateChange', onState);
      this.player.on('error', onError);
      this.player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
    });
  }

  stop(): void {
    this.player.stop(true);
  }
}
