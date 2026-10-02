import { describe, expect, it } from 'vitest';
import { ConversationMemory, withMemory } from '../src/brain/memory.js';
import { FakeLlm } from '../src/pipeline/fakes.js';

const drain = async (it: AsyncIterable<string>): Promise<string> => {
  let s = '';
  for await (const d of it) s += d;
  return s;
};

describe('ConversationMemory', () => {
  it('tags speaker names and alternates roles', () => {
    const m = new ConversationMemory(5);
    m.addExchange('Alex', 'hi', 'hey Alex');
    expect(m.history()).toEqual([
      { role: 'user', text: 'Alex: hi' },
      { role: 'model', text: 'hey Alex' },
    ]);
  });
  it('is bounded to N exchanges, dropping the oldest', () => {
    const m = new ConversationMemory(2);
    for (let i = 1; i <= 4; i++) m.addExchange('A', `q${i}`, `a${i}`);
    expect(m.size).toBe(2);
    expect(m.history()[0]).toEqual({ role: 'user', text: 'A: q3' });
  });
  it('clears on leave', () => {
    const m = new ConversationMemory(2);
    m.addExchange('A', 'q', 'a');
    m.clear();
    expect(m.history()).toEqual([]);
  });
});

describe('withMemory', () => {
  it('passes deltas through and remembers the finished reply', async () => {
    const m = new ConversationMemory(3);
    const llm = withMemory(new FakeLlm(() => ['Hello ', 'there.']), m);
    expect(await drain(llm.stream({ speaker: 'Sam', text: 'yo' }))).toBe('Hello there.');
    expect(m.history()).toEqual([
      { role: 'user', text: 'Sam: yo' },
      { role: 'model', text: 'Hello there.' },
    ]);
  });
  it('does not remember aborted replies', async () => {
    const m = new ConversationMemory(3);
    const ctl = new AbortController();
    const llm = withMemory(new FakeLlm(() => ['Hello ', 'there.']), m);
    const it = llm.stream({ speaker: 'Sam', text: 'yo' }, ctl.signal)[Symbol.asyncIterator]();
    await it.next();
    ctl.abort();
    await it.next();
    expect(m.size).toBe(0);
  });
});
