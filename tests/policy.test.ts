import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isJunkTranscript, isLeaveCommand, junkReason } from '../src/pipeline/policy.js';
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
describe('isLeaveCommand', () => {
  it.each([
    ['parrot leave', true],
    ['Parrot, leave.', true],
    ['PARROT LEAVE!', true],
    ['ok parrot leave now please', true],
    ['hey parrot, leave', true],
    ['parrot', false],
    ['leave', false],
    ['leave parrot', false], // wrong order
    ['the parrot will leave later', false],
    ['I think the parrot leave policy at the zoo is weird', false], // too long: just mentions it
    ['', false],
  ])('%j → %s', (t, expected) => expect(isLeaveCommand(t, 'parrot leave')).toBe(expected));

  it('never matches an empty phrase, and the phrase is configurable', () => {
    expect(isLeaveCommand('anything at all', '')).toBe(false);
    expect(isLeaveCommand('beat it buddy', 'beat it')).toBe(true);
  });
});

describe('junkReason', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['[BLANK_AUDIO]', 'empty'],
    ['hello', 'one word'],
    ['Hey!', 'one word'],
    ['uh', 'one word'],
    ['um uh', 'filler only'],
    ['hey buddy', null],
  ])('%j → %s', (t, reason) => expect(junkReason(t)).toBe(reason));

  it('after a question a real one-word answer is fine and a filler is still filler', () => {
    expect(junkReason('yes', { expectingAnswer: true })).toBeNull();
    expect(junkReason('um', { expectingAnswer: true })).toBe('filler only');
  });
});

function rig(isBot: (id: string) => boolean, text: string, extra: { botTurnGapMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; log?: (m: string) => void } = {}) {
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
  it('logs why an utterance was skipped, without the transcript', async () => {
    const logs: string[] = [];
    const r = rig(() => false, 'swordfish', { log: (m) => logs.push(m) });
    r.speak('a');
    await r.s.whenIdle();
    expect(logs).toEqual(['skipped an utterance (one word): too short or just filler, so no reply']);
    expect(logs.join('\n')).not.toContain('swordfish');
  });
  it('does not log a skip for an utterance that gets answered', async () => {
    const logs: string[] = [];
    const r = rig(() => false, 'hey buddy what is up', { log: (m) => logs.push(m) });
    r.speak('a');
    await r.s.whenIdle();
    expect(logs.filter((l) => l.startsWith('skipped'))).toEqual([]);
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

describe('spoken leave command', () => {
  const setup = (said: string, opts: { ttsDown?: boolean } = {}) => {
    let onStart: (id: string) => void = () => {};
    const streams = new Map<string, PassThrough>();
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const events: string[] = [];
    const asked: string[] = [];
    const s = startSession({
      receiver,
      stt: { transcribe: async () => said },
      llm: new FakeLlm((turn) => (asked.push(turn.text), ['Sure thing, friend.'])),
      tts: opts.ttsDown ? { synthesize: async () => { throw new Error('voice down'); } } : { synthesize: async (t) => (events.push(`tts:${t}`), { pcm: new Int16Array(10), sampleRate: 22050 }) },
      player: { enqueue: () => void events.push('play'), stop() {}, whenIdle: async () => void events.push('idle') },
      capture: CAPTURE,
      minSentenceChars: 8,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
      leave: { phrase: 'parrot leave', farewell: 'Alright, later!' },
      onLeave: () => void events.push('left'),
      log: (m) => events.push(`log:${m}`),
    });
    const speak = (): void => {
      onStart('a');
      const a = new Int16Array(96000);
      for (let i = 0; i < 48000; i++) a[i * 2] = a[i * 2 + 1] = Math.round(6000 * Math.sin((i * 2 * Math.PI * 220) / 48000));
      streams.get('a')!.write(Buffer.from(a.buffer));
      streams.get('a')!.write(Buffer.alloc(48000 * 4));
    };
    return { s, speak, events, asked };
  };

  it('says goodbye, waits for it to finish playing, then leaves, without asking the brain', async () => {
    const r = setup('Parrot, leave.');
    r.speak();
    await r.s.whenIdle();
    expect(r.asked).toEqual([]);
    expect(r.events.filter((e) => !e.startsWith('log:'))).toEqual(['tts:Alright, later!', 'play', 'idle', 'left']);
    expect(r.events).toContain('log:asked to leave by voice');
  });

  it('still leaves when the voice is down', async () => {
    const r = setup('parrot leave', { ttsDown: true });
    r.speak();
    await r.s.whenIdle();
    expect(r.events.filter((e) => !e.startsWith('log:'))).toEqual(['idle', 'left']);
  });

  it('ignores ordinary sentences, even ones that mention a parrot', async () => {
    const r = setup('my parrot is leaving tomorrow so say goodbye to him');
    r.speak();
    await r.s.whenIdle();
    expect(r.events).not.toContain('left');
    expect(r.asked).toHaveLength(1);
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
