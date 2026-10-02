import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedConnection, type ConnectionLike } from '../src/voice/connection.js';

class FakeConn implements ConnectionLike {
  status = 'signalling';
  receiver = {};
  destroyed = false;
  private ls: ((s: string) => void)[] = [];
  onStatus(l: (s: string) => void) {
    this.ls.push(l);
    return () => void (this.ls = this.ls.filter((x) => x !== l));
  }
  emit(s: string) {
    this.status = s;
    this.ls.forEach((l) => l(s));
  }
  destroy() {
    this.destroyed = true;
  }
}

describe('ManagedConnection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (overrides = {}) => {
    const conns: FakeConn[] = [];
    const sleeps: number[] = [];
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      {
        join: () => {
          const c = new FakeConn();
          conns.push(c);
          return c;
        },
        sleep: async (ms) => void sleeps.push(ms),
        recoverMs: 5000,
        ...overrides,
      },
    );
    return { m, conns, sleeps };
  };

  it('joins once and does nothing while healthy', () => {
    const { m, conns } = setup();
    m.start();
    conns[0]!.emit('ready');
    vi.advanceTimersByTime(60_000);
    expect(conns).toHaveLength(1);
  });

  it('heals a short drop without rejoining', () => {
    const { m, conns } = setup();
    m.start();
    conns[0]!.emit('disconnected');
    vi.advanceTimersByTime(2000);
    conns[0]!.emit('ready');
    vi.advanceTimersByTime(10_000);
    expect(conns).toHaveLength(1);
  });

  it('rejoins after a long drop, and again if destroyed', async () => {
    const { m, conns, sleeps } = setup();
    m.start();
    conns[0]!.emit('disconnected');
    await vi.advanceTimersByTimeAsync(5000);
    expect(conns).toHaveLength(2);
    expect(conns[0]!.destroyed).toBe(true);
    conns[1]!.emit('destroyed');
    await vi.advanceTimersByTimeAsync(0);
    expect(conns).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after max rejoins when joining keeps failing, without throwing', async () => {
    const logs: string[] = [];
    let n = 0;
    const first = new FakeConn();
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      {
        join: () => {
          if (n++ === 0) return first;
          throw new Error('dave handshake failed');
        },
        sleep: async () => {},
        maxRejoins: 3,
        log: (s) => logs.push(s),
      },
    );
    m.start();
    first.emit('destroyed');
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(4);
    expect(logs.at(-1)).toContain('giving up');
  });

  it('leave() destroys and stops reacting', async () => {
    const { m, conns } = setup();
    m.start();
    m.leave();
    expect(conns[0]!.destroyed).toBe(true);
    conns[0]!.emit('destroyed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conns).toHaveLength(1);
  });
});
