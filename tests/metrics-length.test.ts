import { describe, expect, it } from 'vitest';
import { ReplyLimiter } from '../src/pipeline/length.js';
import { LatencyRecorder } from '../src/pipeline/metrics.js';
import { FakeLlm, FakeStt, FakeTts } from '../src/pipeline/fakes.js';
import { Orchestrator } from '../src/pipeline/orchestrator.js';

describe('ReplyLimiter', () => {
  it('passes sentences under the cap and drops the one that crosses it', () => {
    const l = new ReplyLimiter(10);
    expect(l.take('One two three four.')).toBe('One two three four.');
    expect(l.take('Five six seven eight nine ten eleven.')).toBeNull();
    expect(l.capped).toBe(true);
    expect(l.take('Short.')).toBeNull();
  });
  it('cuts a single over-long first sentence at a word boundary', () => {
    const l = new ReplyLimiter(4);
    expect(l.take('a b c d e f g, h')).toBe('a b c d.');
  });
});

describe('orchestrator cap', () => {
  it('speaks only whole sentences within the word cap', async () => {
    const spoken: number[] = [];
    const orch = new Orchestrator({
      stt: new FakeStt('hey buddy talk to me'),
      llm: new FakeLlm(() => ['Here is a first sentence. ', 'And a second sentence follows. ', 'The third one is much too long to fit.']),
      tts: new FakeTts(),
      player: { enqueue: () => spoken.push(1), stop() {} },
      minSentenceChars: 8,
      replyWordHardCap: 10,
    });
    const r = await orch.handle({ userId: 'a', userName: 'A', pcm: new Int16Array(16000), startedAt: 0 });
    expect(r?.sentences).toEqual(['Here is a first sentence.', 'And a second sentence follows.']);
  });
});

describe('LatencyRecorder', () => {
  it('computes per-stage and first-word timings, rolling stats over a window', () => {
    let t = 0;
    const rec = new LatencyRecorder(() => t, 2);
    const turn = (stt: number): void => {
      t = 1000;
      rec.begin();
      t += stt;
      rec.trace('heard');
      t += 500;
      rec.trace('sentence');
      rec.trace('sentence'); // only the first counts
      t += 200;
      rec.trace('audio-ready');
      rec.trace('audio-queued');
      rec.finish();
    };
    turn(400);
    expect(rec.last()).toEqual({ sttMs: 400, firstLlmSentenceMs: 500, firstTtsAudioMs: 200, firstWordMs: 1100 });
    turn(600);
    turn(800); // window of 2 drops the first
    const s = rec.summary()!;
    expect(s.sttMs).toEqual({ count: 2, avg: 700, p50: 600, max: 800 });
  });
  it('records nothing for a turn that never produced audio', () => {
    const rec = new LatencyRecorder(() => 0);
    rec.begin();
    rec.trace('heard');
    expect(rec.finish()).toBeNull();
    expect(rec.summary()).toBeNull();
  });
});
