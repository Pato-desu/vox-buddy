import { describe, expect, it } from 'vitest';
import { classifyError, streamReply, type GeminiRequest, type Transport } from '../src/brain/gemini.js';
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

  it('speaks one in-persona line on block and on error', async () => {
    const blocked = mk(async function* () { yield { blockReason: 'SAFETY' }; });
    expect(await collect(blocked.stream({ speaker: 'A', text: 'x' }))).toEqual(['Not touching that.']);
    const failing = mk(() => { throw Object.assign(new Error('x'), { status: 500 }); });
    expect(await collect(failing.stream({ speaker: 'A', text: 'x' }))).toEqual(['My brain hiccuped.']);
  });
});
