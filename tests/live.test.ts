import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { dispatchServerMessage, fromBase64 } from '../src/live/gemini-live.js';
import { LIVE_PRIMER, startLiveSession } from '../src/live/session.js';
import { StreamOutput } from '../src/live/stream-output.js';
import type { LiveConnectOptions, LiveConnection, LiveEvents, LiveOutput } from '../src/live/types.js';
import { normalizeSettings } from '../src/settings.js';
import { formatStatus } from '../src/status.js';
import type { BargeInMode } from '../src/config.js';
import type { ReceiverLike } from '../src/voice/receive.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};

class FakeOutput implements LiveOutput {
  pushed = 0;
  ends = 0;
  stops = 0;
  playing = false;
  private idle: (() => void)[] = [];
  push(): void {
    this.pushed++;
    this.playing = true;
  }
  end(): void {
    this.ends++;
  }
  stop(): void {
    this.stops++;
    this.finish();
  }
  finish(): void {
    this.playing = false;
    this.idle.splice(0).forEach((f) => f());
  }
  whenIdle(): Promise<void> {
    return this.playing ? new Promise((r) => this.idle.push(r)) : Promise.resolve();
  }
}

function rig(opts: { mode?: BargeInMode; failConnects?: number; leave?: boolean } = {}) {
  let onStart: (id: string) => void = () => {};
  const streams = new Map<string, PassThrough>();
  const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
  const output = new FakeOutput();
  const log: string[] = [];
  const connects: { options: LiveConnectOptions; events: LiveEvents }[] = [];
  const sent: string[] = [];
  let failures = opts.failConnects ?? 0;
  const conn: LiveConnection = {
    startActivity: () => void sent.push('start'),
    sendText: (t) => void sent.push(`text:${t}`),
    sendAudio: (p) => void sent.push(`audio:${p.length > 0}`),
    endActivity: () => void sent.push('end'),
    close: () => void sent.push('close'),
  };
  const turns: string[][] = [];
  let left = 0;
  const session = startLiveSession({
    receiver,
    output,
    capture: CAPTURE,
    model: 'm',
    voice: 'v',
    persona: () => 'PERSONA',
    resolveSpeaker: (id) => ({ userId: id, userName: id.toUpperCase(), isBot: false }),
    bargeIn: opts.mode ?? 'stop',
    ...(opts.leave && { leave: { phrase: 'parrot leave' } }),
    onLeave: () => void left++,
    onTurn: (...t) => void turns.push(t),
    log: (m) => void log.push(m),
    sleep: () => Promise.resolve(),
    connect: async (options, events) => {
      if (failures-- > 0) throw new Error('boom');
      connects.push({ options, events });
      return conn;
    },
  });
  const speak = (id: string): void => {
    onStart(id);
    streams.get(id)!.write(tone(1000, 6000));
    streams.get(id)!.write(tone(900, 0));
  };
  const interrupt = (id: string): void => {
    onStart(id);
    streams.get(id)!.write(tone(400, 6000));
  };
  return { session, speak, interrupt, output, log, connects, sent, turns, get left() { return left; }, ev: () => connects.at(-1)!.events };
}

describe('live session', () => {
  it('connects with the persona plus the live primer', async () => {
    const r = rig();
    await tick();
    expect(r.connects).toHaveLength(1);
    expect(r.connects[0]!.options.systemInstruction).toBe(`PERSONA\n\n${LIVE_PRIMER}`);
    expect(r.connects[0]!.options).toMatchObject({ model: 'm', voice: 'v' });
  });

  it('sends an utterance as a named activity and plays the reply audio', async () => {
    const r = rig();
    await tick();
    r.speak('alex');
    await tick(50);
    await r.session.whenSent();
    expect(r.sent).toEqual(['start', 'text:(ALEX is speaking)', 'audio:true', 'end']);
    r.ev().onAudio(new Int16Array(240));
    expect(r.output.pushed).toBe(1);
    r.ev().onInputText('hey buddy ');
    r.ev().onInputText('what is up');
    r.ev().onOutputText('Not much, you?');
    r.ev().onTurnComplete();
    expect(r.output.ends).toBe(1);
    expect(r.turns).toEqual([['ALEX', 'hey buddy what is up', 'Not much, you?']]);
  });

  it('barge-in stops local playback and drops the rest of that reply until the next turn', async () => {
    const r = rig();
    await tick();
    r.ev().onAudio(new Int16Array(240));
    r.interrupt('sam');
    expect(r.output.stops).toBe(1);
    r.ev().onAudio(new Int16Array(240)); // the tail of the cut-off reply
    expect(r.output.pushed).toBe(1);
    r.ev().onTurnComplete();
    r.ev().onAudio(new Int16Array(240)); // next reply plays
    expect(r.output.pushed).toBe(2);
  });

  it('never mode ignores interruptions and holds a new utterance until the reply is done', async () => {
    const r = rig({ mode: 'never' });
    await tick();
    r.ev().onAudio(new Int16Array(240));
    r.interrupt('sam');
    expect(r.output.stops).toBe(0);
    r.speak('sam');
    await tick(50);
    expect(r.sent).toEqual([]);
    r.ev().onTurnComplete();
    r.output.finish();
    await tick(20);
    expect(r.sent[0]).toBe('start');
  });

  it('the server interrupting clears playback', async () => {
    const r = rig();
    await tick();
    r.ev().onAudio(new Int16Array(240));
    r.ev().onInterrupted();
    expect(r.output.stops).toBe(1);
  });

  it('hush keeps listening but sends nothing and silences the reply', async () => {
    const r = rig();
    await tick();
    r.session.setHushed(true);
    expect(r.output.stops).toBe(1);
    r.speak('alex');
    await tick(50);
    expect(r.sent).toEqual([]);
    r.ev().onAudio(new Int16Array(240));
    expect(r.output.pushed).toBe(0);
  });

  it('reconnects after a drop, resuming with the last handle', async () => {
    const r = rig();
    await tick();
    r.ev().onResumeHandle('h1');
    r.ev().onClose('going away');
    await tick(20);
    expect(r.connects).toHaveLength(2);
    expect(r.connects[1]!.options.resumeHandle).toBe('h1');
    expect(r.log.some((l) => l.includes('reconnected'))).toBe(true);
  });

  it('retries a failing first connect and gives up politely after the limit', async () => {
    const r = rig({ failConnects: 2 });
    await tick(30);
    expect(r.connects).toHaveLength(1);
    const dead = rig({ failConnects: 99 });
    await tick(30);
    expect(dead.connects).toHaveLength(0);
    expect(dead.log.at(-1)).toContain('could not reconnect');
  });

  it('does not reconnect after close()', async () => {
    const r = rig();
    await tick();
    r.session.close();
    r.ev().onClose();
    await tick(20);
    expect(r.connects).toHaveLength(1);
    expect(r.sent).toContain('close');
  });

  it('leaves after the goodbye when the cloud heard the leave phrase', async () => {
    const r = rig({ leave: true });
    await tick();
    r.ev().onAudio(new Int16Array(240));
    r.ev().onInputText('Parrot, leave.');
    r.ev().onTurnComplete();
    expect(r.left).toBe(0); // still talking
    r.output.finish();
    await tick();
    expect(r.left).toBe(1);
    expect(r.turns).toEqual([]);
  });
});

describe('Gemini Live message mapping', () => {
  const recorder = () => {
    const calls: string[] = [];
    const ev: LiveEvents = {
      onAudio: (p) => void calls.push(`audio:${p.length}`),
      onInputText: (t) => void calls.push(`in:${t}`),
      onOutputText: (t) => void calls.push(`out:${t}`),
      onTurnComplete: () => void calls.push('turn'),
      onInterrupted: () => void calls.push('interrupted'),
      onResumeHandle: (h) => void calls.push(`handle:${h}`),
      onGoAway: () => void calls.push('goaway'),
      onClose: () => void calls.push('close'),
    };
    return { calls, ev };
  };
  const b64 = Buffer.from(new Int16Array([1, -2, 3]).buffer).toString('base64');

  it('decodes base64 s16le', () => {
    expect([...fromBase64(b64)]).toEqual([1, -2, 3]);
  });

  it('plays the audio before it reports the turn as complete', () => {
    const { calls, ev } = recorder();
    dispatchServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: b64 } }] }, outputTranscription: { text: 'hi' }, turnComplete: true } } as never, ev);
    expect(calls).toEqual(['audio:3', 'out:hi', 'turn']);
  });

  it('maps interruption, transcription, resumption and go-away', () => {
    const { calls, ev } = recorder();
    dispatchServerMessage({ serverContent: { interrupted: true, inputTranscription: { text: 'yo' } }, sessionResumptionUpdate: { newHandle: 'h', resumable: true }, goAway: { timeLeft: '5s' } } as never, ev);
    expect(calls).toEqual(['interrupted', 'in:yo', 'handle:h', 'goaway']);
  });

  it('ignores a resumption update that is not resumable', () => {
    const { calls, ev } = recorder();
    dispatchServerMessage({ sessionResumptionUpdate: { newHandle: 'h', resumable: false } } as never, ev);
    expect(calls).toEqual([]);
  });
});

describe('stream output', () => {
  function fakeSink() {
    const streams: Readable[] = [];
    const resolvers: (() => void)[] = [];
    return {
      streams,
      finish: () => resolvers.splice(0).forEach((f) => f()),
      sink: {
        play: (s: Readable) => new Promise<void>((r) => (streams.push(s), resolvers.push(r))),
        stop: () => resolvers.splice(0).forEach((f) => f()),
      },
    };
  }
  const chunk = (ms: number): Int16Array => new Int16Array((24000 * ms) / 1000);

  it('holds the start until the prebuffer is full, then streams straight through', () => {
    const f = fakeSink();
    const o = new StreamOutput(f.sink, 250);
    o.push(chunk(100));
    o.push(chunk(100));
    expect(f.streams).toHaveLength(0);
    o.push(chunk(100));
    expect(f.streams).toHaveLength(1);
    expect(o.playing).toBe(true);
    o.push(chunk(40));
    expect(f.streams[0]!.readableLength).toBeGreaterThan(0);
  });

  it('a short reply still plays when it ends before the prebuffer fills', () => {
    const f = fakeSink();
    const o = new StreamOutput(f.sink, 250);
    o.push(chunk(60));
    o.end();
    expect(f.streams).toHaveLength(1);
  });

  it('whenIdle resolves after the sink finishes; stop() drops everything and resolves too', async () => {
    const f = fakeSink();
    const o = new StreamOutput(f.sink, 0);
    o.push(chunk(20));
    o.end();
    let idle = false;
    void o.whenIdle().then(() => (idle = true));
    await tick();
    expect(idle).toBe(false);
    f.finish();
    await tick();
    expect(idle).toBe(true);
    expect(o.playing).toBe(false);

    o.push(chunk(20));
    const stopped = o.whenIdle();
    o.stop();
    await stopped;
    expect(o.playing).toBe(false);
    o.push(chunk(20)); // a later reply starts a fresh stream
    expect(f.streams).toHaveLength(3);
  });
});

describe('live mode settings and status', () => {
  it('defaults to classic and only accepts live explicitly', () => {
    expect(normalizeSettings({}).mode).toBe('classic');
    expect(normalizeSettings({ mode: 'bogus' }).mode).toBe('classic');
    expect(normalizeSettings({ mode: 'live' }).mode).toBe('live');
  });

  it('status names the mode and the cloud audio', () => {
    const text = formatStatus({ channelName: 'general', hushed: false, settings: { voice: 'fast', cloneSample: null, mode: 'live' }, liveModel: 'gemini-3.8-live', sidecar: { ok: false }, latency: null });
    expect(text).toContain('gemini-3.8-live');
    expect(text).toContain('goes to Google');
    expect(text).not.toContain('sidecar: DOWN');
  });
});
