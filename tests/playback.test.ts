import { describe, expect, it } from 'vitest';
import { PlaybackQueue, type ChunkSink } from '../src/voice/playback.js';
import type { AudioChunk } from '../src/pipeline/types.js';

const chunk = (n: number): AudioChunk => ({ pcm: Int16Array.of(n), sampleRate: 16000 });

function manualSink() {
  const played: number[] = [];
  let release: (() => void) | undefined;
  let stops = 0;
  const sink: ChunkSink = {
    play: (c) => {
      played.push(c.pcm[0]!);
      return new Promise<void>((r) => (release = r));
    },
    stop: () => {
      stops++;
      release?.();
    },
  };
  return { sink, played, finish: () => release?.(), stops: () => stops };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('PlaybackQueue', () => {
  it('plays chunks in order and reports start/end/idle', async () => {
    const m = manualSink();
    const q = new PlaybackQueue(m.sink);
    const events: string[] = [];
    q.on('start', (c) => events.push(`start${c.pcm[0]}`));
    q.on('end', (c) => events.push(`end${c.pcm[0]}`));
    q.on('idle', () => events.push('idle'));
    q.enqueue(chunk(1));
    q.enqueue(chunk(2));
    await tick();
    expect(m.played).toEqual([1]);
    m.finish();
    await tick();
    m.finish();
    await tick();
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2', 'idle']);
    expect(q.playing).toBe(false);
  });

  it('stop() halts the current chunk and drops the queue', async () => {
    const m = manualSink();
    const q = new PlaybackQueue(m.sink);
    q.enqueue(chunk(1));
    q.enqueue(chunk(2));
    q.enqueue(chunk(3));
    await tick();
    q.stop();
    await tick();
    expect(m.played).toEqual([1]);
    expect(m.stops()).toBe(1);
    expect(q.pending).toBe(0);
    expect(q.playing).toBe(false);
  });

  it('plays new audio enqueued after a stop', async () => {
    const m = manualSink();
    const q = new PlaybackQueue(m.sink);
    q.enqueue(chunk(1));
    await tick();
    q.stop();
    q.enqueue(chunk(9));
    await tick();
    await tick();
    expect(m.played).toEqual([1, 9]);
  });

  it('a failing sink does not wedge the queue', async () => {
    let fail = true;
    const played: number[] = [];
    const q = new PlaybackQueue({
      play: async (c) => {
        if (fail) throw new Error('boom');
        played.push(c.pcm[0]!);
      },
      stop() {},
    });
    q.enqueue(chunk(1));
    await tick();
    fail = false;
    q.enqueue(chunk(2));
    await tick();
    expect(played).toEqual([2]);
  });
});

import { toDiscordPcm } from '../src/voice/discord-sink.js';

describe('toDiscordPcm', () => {
  it('upsamples mono 16 kHz to 48 kHz stereo', () => {
    const out = new Int16Array(toDiscordPcm({ pcm: Int16Array.of(0, 3000, 3000), sampleRate: 16000 }).buffer.slice(0));
    expect(out.length).toBe(9 * 2);
    expect(out[0]).toBe(out[1]);
    expect(out[2]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(3000);
  });
});
