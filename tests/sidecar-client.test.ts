import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SidecarClient, SidecarError, decodeWav, encodeWav } from '../src/speech/client.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function fake(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('wav', () => {
  it('roundtrips pcm', () => {
    const pcm = Int16Array.of(1, -2, 300, -32768, 32767);
    const out = decodeWav(encodeWav(pcm, 16000));
    expect(out.sampleRate).toBe(16000);
    expect([...out.pcm]).toEqual([...pcm]);
  });
});

describe('SidecarClient', () => {
  it('reports health, and ok:false when down', async () => {
    const url = await fake((_q, res) => res.end(JSON.stringify({ ok: true, stt: 'fake', tts: 'fake' })));
    expect(await new SidecarClient({ baseUrl: url }).health()).toEqual({ ok: true, stt: 'fake', tts: 'fake' });
    expect(await new SidecarClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 }).health()).toEqual({ ok: false });
  });

  it('transcribes by posting a wav', async () => {
    let got = 0;
    const url = await fake((q, res) => {
      const parts: Buffer[] = [];
      q.on('data', (c: Buffer) => parts.push(c));
      q.on('end', () => {
        got = decodeWav(Buffer.concat(parts)).pcm.length;
        res.end(JSON.stringify({ text: 'hello' }));
      });
    });
    expect(await new SidecarClient({ baseUrl: url }).transcribe(new Int16Array(160), 16000)).toBe('hello');
    expect(got).toBe(160);
  });

  it('synthesizes and decodes the returned wav', async () => {
    const url = await fake((_q, res) => res.end(encodeWav(Int16Array.of(5, 6, 7), 22050)));
    const chunk = await new SidecarClient({ baseUrl: url }).synthesize('hi there');
    expect(chunk.sampleRate).toBe(22050);
    expect([...chunk.pcm]).toEqual([5, 6, 7]);
  });

  it('sends the voice and sample, and surfaces the 409 reason', async () => {
    let body = '';
    const url = await fake((q, res) => {
      q.on('data', (d) => (body += d));
      q.on('end', () => { res.statusCode = 409; res.end('{"detail":"low vram: 900 MB free"}'); });
    });
    const c = new SidecarClient({ baseUrl: url, retryDelayMs: 1 });
    await expect(c.synthesizeVoice('hi there', 'clone', 'me')).rejects.toThrow(/409.*low vram/);
    expect(JSON.parse(body)).toEqual({ text: 'hi there', voice: 'clone', sample: 'me' });
  });

  it('warmup resolves true on success and false on failure, never throwing', async () => {
    const ok = await fake((_q, res) => res.end('{"ok":true}'));
    expect(await new SidecarClient({ baseUrl: ok }).warmup('me')).toBe(true);
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    expect(await new SidecarClient({ baseUrl: 'http://127.0.0.1:1', retries: 0 }).warmup('me')).toBe(false);
  });

  it('retries 5xx then succeeds', async () => {
    let n = 0;
    const url = await fake((_q, res) => {
      if (++n < 3) { res.statusCode = 503; res.end(); } else res.end(JSON.stringify({ text: 'ok' }));
    });
    const c = new SidecarClient({ baseUrl: url, retryDelayMs: 1 });
    expect(await c.transcribe(new Int16Array(8), 16000)).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry 4xx', async () => {
    let n = 0;
    const url = await fake((_q, res) => { n++; res.statusCode = 400; res.end(); });
    await expect(new SidecarClient({ baseUrl: url, retryDelayMs: 1 }).synthesize('x')).rejects.toBeInstanceOf(SidecarError);
    expect(n).toBe(1);
  });

  it('times out and gives a SidecarError after retries', async () => {
    const url = await fake(() => { /* never responds */ });
    const c = new SidecarClient({ baseUrl: url, timeoutMs: 50, retries: 1, retryDelayMs: 1 });
    await expect(c.synthesize('x')).rejects.toBeInstanceOf(SidecarError);
  });
});
