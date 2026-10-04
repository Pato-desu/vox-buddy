import { joinVoiceChannel, VoiceConnectionDisconnectReason, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import type { DiscordGateway } from './types.js';

/** The slice of a voice connection this code relies on. A fake implements it in tests. */
export interface ConnectionLike {
  readonly status: string;
  onStatus(listener: (status: string) => void): () => void;
  destroy(): void;
  /** The underlying receiver (opaque here). */
  readonly receiver: unknown;
}

export interface JoinTarget {
  guildId: string;
  channelId: string;
}

export type Joiner = (target: JoinTarget) => ConnectionLike;

export interface ManagedOptions {
  join: Joiner;
  /** How long a dropped connection may heal itself before we rejoin. */
  recoverMs?: number;
  maxRejoins?: number;
  /** A connection that isn't ready by then (e.g. stuck in the DAVE handshake) is replaced. Default 20 s. */
  readyTimeoutMs?: number;
  /** Called for the first connection and every replacement, so callers can rebind receivers and players. */
  onConnection?: (conn: ConnectionLike) => void;
  /** Called once when rejoining is abandoned. */
  onGiveUp?: () => void;
  /** Called once when Discord removed the bot from the channel (kick or "Disconnect"). It does not rejoin. */
  onKicked?: () => void;
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

/** Keeps one voice connection alive: heals short drops, rejoins with backoff, gives up after N tries. */
export class ManagedConnection {
  private conn: ConnectionLike | undefined;
  private unsub: (() => void) | undefined;
  private rejoins = 0;
  private closed = false;
  private recovering = false;
  private recoverTimer: ReturnType<typeof setTimeout> | undefined;
  private kickTimer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly target: JoinTarget, private readonly o: ManagedOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get connection(): ConnectionLike | undefined {
    return this.conn;
  }

  start(): ConnectionLike {
    this.attach(this.o.join(this.target));
    return this.conn!;
  }

  leave(): void {
    this.closed = true;
    clearTimeout(this.recoverTimer);
    clearTimeout(this.kickTimer);
    clearTimeout(this.readyTimer);
    this.detach();
    this.conn?.destroy();
    this.conn = undefined;
  }

  private attach(conn: ConnectionLike): void {
    this.conn = conn;
    this.unsub = conn.onStatus((s) => this.onStatus(s));
    clearTimeout(this.readyTimer);
    if (conn.status !== 'ready') {
      this.readyTimer = setTimeout(() => {
        this.o.log?.('voice: not ready in time (DAVE handshake stuck?), rejoining');
        void this.rejoin();
      }, this.o.readyTimeoutMs ?? 20_000);
    }
    this.o.onConnection?.(conn);
  }

  private detach(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  private onStatus(status: string): void {
    if (this.closed) return;
    if (status === 'ready') {
      this.rejoins = 0;
      clearTimeout(this.recoverTimer);
      clearTimeout(this.kickTimer);
      clearTimeout(this.readyTimer);
      return;
    }
    if (status === 'signalling' || status === 'connecting') {
      clearTimeout(this.kickTimer); // moved to another channel: Discord is reconnecting us itself
      return;
    }
    if (status === 'removed') {
      // Close code 4014: moved (Discord reconnects within seconds) or removed (it doesn't). Wait to tell which.
      clearTimeout(this.recoverTimer);
      clearTimeout(this.kickTimer);
      this.kickTimer = setTimeout(() => {
        this.o.log?.('voice: removed from the channel, not rejoining');
        this.leave();
        this.o.onKicked?.();
      }, this.o.recoverMs ?? 5000);
      return;
    }
    if (status === 'disconnected') {
      // Discord often moves the bot between channels or restarts the session: give it a moment to heal.
      clearTimeout(this.recoverTimer);
      this.recoverTimer = setTimeout(() => void this.rejoin(), this.o.recoverMs ?? 5000);
    } else if (status === 'destroyed') {
      void this.rejoin();
    }
  }

  private async rejoin(): Promise<void> {
    if (this.closed || this.recovering) return;
    this.recovering = true;
    try {
      while (!this.closed && this.rejoins < (this.o.maxRejoins ?? 5)) {
        this.rejoins++;
        const wait = (this.o.backoffMs ?? ((n) => Math.min(30_000, 1000 * 2 ** (n - 1))))(this.rejoins);
        this.o.log?.(`voice: rejoin attempt ${this.rejoins} in ${wait} ms`);
        await this.sleep(wait);
        if (this.closed) return;
        this.detach();
        try {
          this.conn?.destroy();
        } catch {
          /* already destroyed */
        }
        try {
          this.attach(this.o.join(this.target));
          return;
        } catch (e) {
          this.o.log?.(`voice: rejoin failed: ${(e as Error).message}`);
        }
      }
      if (!this.closed) {
        this.o.log?.('voice: giving up after repeated rejoin failures');
        this.o.onGiveUp?.();
      }
    } finally {
      this.recovering = false;
    }
  }
}

/** Discord closes the voice socket with 4014 when the bot is moved, kicked or its channel deleted. */
const CLOSE_CODE_REMOVED = 4014;

/** The status string ManagedConnection sees: a 4014 disconnect becomes 'removed', anything else passes through. */
export function voiceStatusOf(state: { status: string; reason?: unknown; closeCode?: number }): string {
  const removed = state.status === VoiceConnectionStatus.Disconnected && state.reason === VoiceConnectionDisconnectReason.WebSocketClose && state.closeCode === CLOSE_CODE_REMOVED;
  return removed ? 'removed' : state.status;
}

/** Real joiner: @discordjs/voice with DAVE end-to-end encryption on (mandatory on Discord). */
export function createDiscordJoiner(gateway: DiscordGateway): Joiner {
  return ({ guildId, channelId }) => {
    const raw: VoiceConnection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: gateway.adapterFor(guildId),
      selfDeaf: false,
      selfMute: false,
      daveEncryption: true,
      decryptionFailureTolerance: 36,
    });
    return {
      get status() {
        return raw.state.status;
      },
      onStatus(listener) {
        const h = (_o: unknown, n: { status: string; reason?: unknown; closeCode?: number }) => listener(voiceStatusOf(n));
        raw.on('stateChange', h);
        return () => void raw.off('stateChange', h);
      },
      destroy: () => {
        if (raw.state.status !== VoiceConnectionStatus.Destroyed) raw.destroy();
      },
      receiver: raw.receiver,
    };
  };
}

