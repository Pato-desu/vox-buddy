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

describe('ManagedConnection recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replaces a connection stuck before ready (DAVE handshake) and reports each connection', async () => {
    const conns: FakeConn[] = [];
    const seen: ConnectionLike[] = [];
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      { join: () => (conns.push(new FakeConn()), conns.at(-1)!), sleep: async () => {}, readyTimeoutMs: 10_000, onConnection: (c) => seen.push(c) },
    );
    m.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conns).toHaveLength(2);
    expect(conns[0]!.destroyed).toBe(true);
    expect(seen).toEqual(conns);
    conns[1]!.emit('ready'); // the replacement comes up: no more rejoins
    await vi.advanceTimersByTimeAsync(60_000);
    expect(conns).toHaveLength(2);
  });

  it('calls onGiveUp once when rejoining is abandoned', async () => {
    let gaveUp = 0;
    let n = 0;
    const first = new FakeConn();
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      { join: () => { if (n++ === 0) return first; throw new Error('no'); }, sleep: async () => {}, maxRejoins: 2, onGiveUp: () => gaveUp++ },
    );
    m.start();
    first.emit('destroyed');
    await vi.advanceTimersByTimeAsync(0);
    expect(gaveUp).toBe(1);
  });

  it('keeps going through repeated disconnects without crashing', async () => {
    const conns: FakeConn[] = [];
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      { join: () => (conns.push(new FakeConn()), conns.at(-1)!), sleep: async () => {}, recoverMs: 100 },
    );
    m.start();
    for (let i = 0; i < 4; i++) {
      conns.at(-1)!.emit('ready');
      conns.at(-1)!.emit('disconnected');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(conns).toHaveLength(5);
  });
});
