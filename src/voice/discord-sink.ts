import { AudioPlayerStatus, StreamType, createAudioPlayer, createAudioResource, type AudioPlayer } from '@discordjs/voice';
import { Readable } from 'node:stream';
import type { AudioChunk } from '../pipeline/types.js';
import type { ChunkSink } from './playback.js';

/** Mono s16 at any rate → 48 kHz interleaved stereo s16 (linear interpolation). */
export function toDiscordPcm(chunk: AudioChunk): Buffer {
  const { pcm, sampleRate } = chunk;
  const outFrames = Math.floor((pcm.length * 48000) / sampleRate);
  const out = new Int16Array(outFrames * 2);
  const step = sampleRate / 48000;
  for (let i = 0; i < outFrames; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const a = pcm[i0] ?? 0;
    const b = pcm[Math.min(i0 + 1, pcm.length - 1)] ?? a;
    const v = Math.round(a + (b - a) * (pos - i0));
    out[i * 2] = v;
    out[i * 2 + 1] = v;
  }
  return Buffer.from(out.buffer);
}

/** ChunkSink over a @discordjs/voice AudioPlayer. Subscribe the player to the connection elsewhere. */
export class DiscordSink implements ChunkSink {
  readonly player: AudioPlayer = createAudioPlayer();

  play(chunk: AudioChunk): Promise<void> {
    return new Promise((resolve, reject) => {
      const resource = createAudioResource(Readable.from([toDiscordPcm(chunk)]), { inputType: StreamType.Raw });
      const onState = (_o: unknown, n: { status: AudioPlayerStatus }): void => {
        if (n.status === AudioPlayerStatus.Idle) done();
      };
      const onError = (e: Error): void => {
        cleanup();
        reject(e);
      };
      const cleanup = (): void => {
        this.player.off('stateChange', onState);
        this.player.off('error', onError);
      };
      const done = (): void => {
        cleanup();
        resolve();
      };
      this.player.on('stateChange', onState);
      this.player.on('error', onError);
      this.player.play(resource);
    });
  }

  stop(): void {
    this.player.stop(true);
  }
}
