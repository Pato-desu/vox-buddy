import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceConnectionDisconnectReason, VoiceConnectionStatus } from '@discordjs/voice';
import { ManagedConnection, voiceStatusOf, type ConnectionLike } from '../src/voice/connection.js';

describe('voiceStatusOf', () => {
  it("turns only a 4014 websocket close into 'removed'", () => {
    const ws = VoiceConnectionDisconnectReason.WebSocketClose;
    expect(voiceStatusOf({ status: VoiceConnectionStatus.Disconnected, reason: ws, closeCode: 4014 })).toBe('removed');
    expect(voiceStatusOf({ status: VoiceConnectionStatus.Disconnected, reason: ws, closeCode: 4006 })).toBe('disconnected');
    expect(voiceStatusOf({ status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.EndpointRemoved })).toBe('disconnected');
    expect(voiceStatusOf({ status: VoiceConnectionStatus.Ready })).toBe('ready');
    expect(voiceStatusOf({ status: VoiceConnectionStatus.Destroyed })).toBe('destroyed');
  });
});

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

  it('stays out when Discord removed it from the channel (kick), and tells the caller once', async () => {
    const conns: FakeConn[] = [];
    let kicked = 0;
    const logs: string[] = [];
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      { join: () => (conns.push(new FakeConn()), conns.at(-1)!), sleep: async () => {}, recoverMs: 5000, onKicked: () => kicked++, log: (s) => logs.push(s) },
    );
    m.start();
    conns[0]!.emit('ready');
    conns[0]!.emit('removed');
    await vi.advanceTimersByTimeAsync(4999);
    expect(kicked).toBe(0); // still might be a move to another channel
    await vi.advanceTimersByTimeAsync(1);
    expect(kicked).toBe(1);
    expect(conns[0]!.destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(conns).toHaveLength(1); // never rejoined
    expect(kicked).toBe(1);
    expect(logs.join('\n')).toContain('removed from the channel');
  });

  it('does not treat a move to another channel as a kick', async () => {
    const conns: FakeConn[] = [];
    let kicked = 0;
    const m = new ManagedConnection(
      { guildId: 'g', channelId: 'c' },
      { join: () => (conns.push(new FakeConn()), conns.at(-1)!), sleep: async () => {}, recoverMs: 5000, onKicked: () => kicked++ },
    );
    m.start();
    conns[0]!.emit('ready');
    conns[0]!.emit('removed'); // 4014 also happens when moved...
    await vi.advanceTimersByTimeAsync(1500);
    conns[0]!.emit('signalling'); // ...and then Discord reconnects us itself
    conns[0]!.emit('connecting');
    conns[0]!.emit('ready');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(kicked).toBe(0);
    expect(conns).toHaveLength(1);
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
