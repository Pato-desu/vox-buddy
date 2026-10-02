import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isJunkTranscript } from '../src/pipeline/policy.js';
import { FakeLlm, FakeStt, FakeTts } from '../src/pipeline/fakes.js';
import { startSession } from '../src/session.js';
import type { ReceiverLike } from '../src/voice/receive.js';

describe('isJunkTranscript', () => {
  it.each([
    ['', true],
    ['hello', true],
    ['uh', true],
    ['Um, uh...', true],
    ['hmm hmm', true],
    ['[BLANK_AUDIO]', true],
    ['(music) uh', true],
    ['hey buddy', false],
    ['uh what time is it', false],
    ["what's up", false],
  ])('%j → junk=%s', (t, junk) => expect(isJunkTranscript(t)).toBe(junk));
});

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
function rig(isBot: (id: string) => boolean, text: string, extra: { botTurnGapMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
  let onStart: (id: string) => void = () => {};
  const streams = new Map<string, PassThrough>();
  const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
  const tone = (ms: number, amp: number): Buffer => {
    const n = (48000 * ms) / 1000;
    const a = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
    return Buffer.from(a.buffer);
  };
  const speak = (id: string): void => {
    onStart(id);
    streams.get(id)?.write(tone(1000, 6000));
    streams.get(id)?.write(tone(900, 0));
  };
  const replies: string[] = [];
  const s = startSession({
    receiver,
    stt: new FakeStt(text),
    llm: new FakeLlm((t) => (replies.push(t.speaker), ['Sure thing, friend.'])),
    tts: new FakeTts(),
    player: { enqueue() {}, stop() {} },
    capture: CAPTURE,
    minSentenceChars: 12,
    resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: isBot(id) }),
    ...extra,
  });
  return { speak, s, replies };
}

describe('one-word answers', () => {
  it('are accepted right after the bot asked something, but fillers still are not', () => {
    expect(isJunkTranscript('yes')).toBe(true);
    expect(isJunkTranscript('yes', { expectingAnswer: true })).toBe(false);
    expect(isJunkTranscript('um', { expectingAnswer: true })).toBe(true);
  });
});

describe('answers-everything policy', () => {
  it('replies to every accepted human utterance', async () => {
    const r = rig(() => false, 'hey buddy what is up');
    r.speak('a');
    r.speak('b');
    await r.s.whenIdle();
    expect(r.replies).toEqual(['a', 'b']);
  });
  it('never answers its own or other bots audio', async () => {
    const r = rig((id) => id === 'self' || id === 'otherbot', 'hey buddy what is up');
    r.speak('self');
    r.speak('otherbot');
    await r.s.whenIdle();
    expect(r.replies).toEqual([]);
  });
  it('drops junk transcripts', async () => {
    const r = rig(() => false, 'uh');
    r.speak('a');
    await r.s.whenIdle();
    expect(r.replies).toEqual([]);
  });
  it('waits out the turn gap between replies', async () => {
    let t = 0;
    const waits: number[] = [];
    const r = rig(() => false, 'hey buddy what is up', {
      botTurnGapMs: 1500,
      now: () => t,
      sleep: async (ms) => void (waits.push(ms), (t += ms)),
    });
    r.speak('a');
    r.speak('b');
    await r.s.whenIdle();
    expect(r.replies).toEqual(['a', 'b']);
    expect(waits).toEqual([1500]); // none before the first reply, a full gap before the second
  });
});

describe('session: answering a question the bot asked', () => {
  it('replies to a bare "yes" only after the bot asked a question', async () => {
    let onStart: (id: string) => void = () => {};
    const streams = new Map<string, PassThrough>();
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const said = ['hey buddy any ideas', 'yes', 'yes'];
    const heard: string[] = [];
    let t = 0;
    const s = startSession({
      receiver,
      stt: { transcribe: async () => said.shift()! },
      llm: new FakeLlm((turn) => (heard.push(turn.text), [turn.text === 'yes' ? 'Great, here we go.' : 'Want to play a game?'])),
      tts: new FakeTts(),
      player: { enqueue() {}, stop() {} },
      capture: CAPTURE,
      minSentenceChars: 8,
      now: () => t,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
    });
    const speak = (id: string): void => {
      onStart(id);
      const n = 48000;
      const a = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(6000 * Math.sin((i * 2 * Math.PI * 220) / 48000));
      streams.get(id)!.write(Buffer.from(a.buffer));
      streams.get(id)!.write(Buffer.alloc(48000 * 4));
    };
    speak('a');
    await s.whenIdle();
    speak('a'); // "yes" right after the question: answered
    await s.whenIdle();
    t += 60_000; // much later, the question is stale
    speak('a');
    await s.whenIdle();
    expect(heard).toEqual(['hey buddy any ideas', 'yes']);
  });
});
