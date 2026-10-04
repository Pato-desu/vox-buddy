import { describe, expect, it } from 'vitest';
import { classifyError, streamReply, toUsage, type GeminiRequest, type TokenUsage, type Transport } from '../src/brain/gemini.js';
import { GeminiLlm } from '../src/brain/llm.js';

const req: GeminiRequest = { model: 'm', systemInstruction: 's', temperature: 0.9, history: [{ role: 'user', text: 'Alex: hi' }] };
const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe('streamReply', () => {
  it('yields text deltas from a fake transport, skipping empty ones', async () => {
    const t: Transport = async function* () { yield { text: 'Hel' }; yield { text: '' }; yield { text: 'lo' }; };
    expect(await collect(streamReply(t, req))).toEqual([{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }]);
  });

  it('reports safety blocks and stops', async () => {
    const t: Transport = async function* () { yield { text: 'a' }; yield { blockReason: 'SAFETY' }; yield { text: 'never' }; };
    expect(await collect(streamReply(t, req))).toEqual([{ type: 'text', text: 'a' }, { type: 'blocked', reason: 'SAFETY' }]);
  });

  it('turns thrown errors into typed events', async () => {
    const t: Transport = () => { throw Object.assign(new Error('slow down'), { status: 429 }); };
    expect(await collect(streamReply(t, req))).toEqual([{ type: 'error', kind: 'rate_limit', message: 'slow down' }]);
  });

  it.each([[503, 'server'], [401, 'auth'], [400, 'unknown']])('classifies %s as %s', (status, kind) => {
    expect(classifyError({ status, message: 'x' }).kind).toBe(kind);
  });

  it('passes token usage through as events, before a block', async () => {
    const usage = { promptTokens: 10, outputTokens: 2, thinkingTokens: 0 };
    const t: Transport = async function* () { yield { text: 'a', usage }; yield { blockReason: 'SAFETY', usage: { ...usage, outputTokens: 3 } }; };
    expect(await collect(streamReply(t, req))).toEqual([
      { type: 'usage', ...usage },
      { type: 'text', text: 'a' },
      { type: 'usage', ...usage, outputTokens: 3 },
      { type: 'blocked', reason: 'SAFETY' },
    ]);
  });
});

describe('toUsage', () => {
  it("reads Gemini's usageMetadata and ignores metadata without counts", () => {
    expect(toUsage({ promptTokenCount: 115, candidatesTokenCount: 12, thoughtsTokenCount: 30 })).toEqual({ promptTokens: 115, outputTokens: 12, thinkingTokens: 30 });
    expect(toUsage({ promptTokenCount: 115 })).toEqual({ promptTokens: 115, outputTokens: 0, thinkingTokens: 0 });
    expect(toUsage({})).toBeUndefined();
    expect(toUsage(undefined)).toBeUndefined();
    expect(toUsage(null)).toBeUndefined();
  });
});

describe('GeminiLlm', () => {
  const mk = (transport: Transport) =>
    new GeminiLlm({ transport, model: 'm', temperature: 0.5, persona: 'P', blockedLine: 'Not touching that.', errorLine: 'My brain hiccuped.' });

  it('sends persona, speaker-tagged history and yields deltas', async () => {
    let seen: GeminiRequest | undefined;
    const llm = mk(async function* (r) { seen = r; yield { text: 'Yo' }; });
    expect(await collect(llm.stream({ speaker: 'Alex', text: 'hey' }))).toEqual(['Yo']);
    expect(seen?.systemInstruction).toBe('P');
    expect(seen?.history).toEqual([{ role: 'user', text: 'Alex: hey' }]);
  });

  it('reports the last (cumulative) token usage once per request', async () => {
    const used: TokenUsage[] = [];
    const llm = new GeminiLlm({
      transport: async function* () {
        yield { text: 'Yo', usage: { promptTokens: 100, outputTokens: 1, thinkingTokens: 0 } };
        yield { text: ' there', usage: { promptTokens: 100, outputTokens: 4, thinkingTokens: 2 } };
      },
      model: 'm', temperature: 0.5, persona: 'P', blockedLine: 'b', errorLine: 'e',
      onUsage: (u) => used.push(u),
    });
    expect(await collect(llm.stream({ speaker: 'A', text: 'x' }))).toEqual(['Yo', ' there']);
    expect(used).toEqual([{ promptTokens: 100, outputTokens: 4, thinkingTokens: 2 }]);
  });

  it('still reports usage when the reply is cut short by the caller, and nothing when none was reported', async () => {
    const used: TokenUsage[] = [];
    const llm = new GeminiLlm({
      transport: async function* () {
        yield { text: 'One. ', usage: { promptTokens: 50, outputTokens: 2, thinkingTokens: 0 } };
        yield { text: 'Two.' };
      },
      model: 'm', temperature: 0.5, persona: 'P', blockedLine: 'b', errorLine: 'e',
      onUsage: (u) => used.push(u),
    });
    await llm.stream({ speaker: 'A', text: 'x' })[Symbol.asyncIterator]().return?.(); // not started: no usage yet
    expect(used).toEqual([]);
    const it = llm.stream({ speaker: 'A', text: 'x' })[Symbol.asyncIterator]();
    await it.next(); // first sentence arrives...
    await it.return?.(); // ...then barge-in: the consumer stops early
    expect(used).toEqual([{ promptTokens: 50, outputTokens: 2, thinkingTokens: 0 }]);
    used.length = 0;
    const silent = new GeminiLlm({ transport: async function* () { yield { text: 'Hi' }; }, model: 'm', temperature: 0.5, persona: 'P', blockedLine: 'b', errorLine: 'e', onUsage: (u) => used.push(u) });
    await collect(silent.stream({ speaker: 'A', text: 'x' }));
    expect(used).toEqual([]);
  });

  it('speaks one in-persona line on block and on error', async () => {
    const blocked = mk(async function* () { yield { blockReason: 'SAFETY' }; });
    expect(await collect(blocked.stream({ speaker: 'A', text: 'x' }))).toEqual(['Not touching that.']);
    const failing = mk(() => { throw Object.assign(new Error('x'), { status: 500 }); });
    expect(await collect(failing.stream({ speaker: 'A', text: 'x' }))).toEqual(['My brain hiccuped.']);
  });
});
