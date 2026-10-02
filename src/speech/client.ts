import type { AudioChunk, Stt, Tts } from '../pipeline/types.js';

export interface SidecarOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class SidecarError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'SidecarError';
  }
}

export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function decodeWav(buf: Buffer): AudioChunk {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new SidecarError('invalid wav from sidecar');
  const sampleRate = buf.readUInt32LE(24);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const bytes = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
      const pcm = new Int16Array(Math.floor(bytes.length / 2));
      for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
      return { pcm, sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new SidecarError('wav has no data chunk');
}

/** HTTP client for the speech sidecar: timeouts, retries on 5xx/network errors, health. */
export class SidecarClient implements Stt, Tts {
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly o: SidecarOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.retries = o.retries ?? 2;
    this.retryDelayMs = o.retryDelayMs ?? 200;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      const timeout = AbortSignal.timeout(this.timeoutMs);
      try {
        const res = await this.f(this.o.baseUrl + path, {
          ...init,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (res.status >= 500) {
          last = new SidecarError(`sidecar ${path} returned ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) throw new SidecarError(`sidecar ${path} returned ${res.status}`, res.status);
        return res;
      } catch (e) {
        if (e instanceof SidecarError) throw e;
        if (signal?.aborted) throw e;
        last = e;
      }
    }
    throw last instanceof SidecarError ? last : new SidecarError(`sidecar unreachable: ${(last as Error)?.message ?? last}`);
  }

  async health(): Promise<{ ok: boolean; stt?: string; tts?: string }> {
    try {
      const res = await this.f(this.o.baseUrl + '/health', { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return { ok: false };
      return (await res.json()) as { ok: boolean; stt?: string; tts?: string };
    } catch {
      return { ok: false };
    }
  }

  async transcribe(pcm: Int16Array, sampleRate: number): Promise<string> {
    const res = await this.request('/stt', { method: 'POST', body: new Uint8Array(encodeWav(pcm, sampleRate)) });
    return ((await res.json()) as { text: string }).text;
  }

  async synthesize(sentence: string, signal?: AbortSignal): Promise<AudioChunk> {
    const res = await this.request(
      '/tts',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: sentence }) },
      signal,
    );
    return decodeWav(Buffer.from(await res.arrayBuffer()));
  }
}
