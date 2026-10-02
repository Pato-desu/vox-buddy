import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger, parseLogLevel, redactSecrets, type LogLevel } from '../src/log.js';

const FAKE_GOOGLE = 'AIza' + 'x'.repeat(35);
const FAKE_DISCORD = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GhIjKl', 'abcdefghijklmnopqrstuvwxyz1'].join('.');

describe('redaction', () => {
  it('removes registered secret values and key-shaped strings', () => {
    expect(redactSecrets('token=hunter2secret ok', ['hunter2secret'])).toBe('token=[redacted] ok');
    expect(redactSecrets(`key ${FAKE_GOOGLE} end`)).toBe('key [redacted] end');
    expect(redactSecrets(`login ${FAKE_DISCORD} now`)).toBe('login [redacted] now');
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('[redacted]');
  });
  it('leaves ordinary text alone', () => {
    expect(redactSecrets('turn: Alex → 2 sentence(s)', ['x'])).toBe('turn: Alex → 2 sentence(s)');
  });
});

describe('logger', () => {
  const run = (level: LogLevel | undefined) => {
    const lines: string[] = [];
    const log = createLogger({ level, secrets: ['s3cretvalue'], write: (l, m) => lines.push(`${l}:${m}`) });
    log.debug('heard: hello there');
    log.info('joined s3cretvalue');
    log.error('bad');
    return lines;
  };
  it('keeps transcripts (debug) out of a normal run and redacts everything', () => {
    expect(run(undefined)).toEqual(['info:joined [redacted]', 'error:bad']);
  });
  it('shows transcripts only at debug level', () => {
    expect(run('debug')).toContain('debug:heard: hello there');
  });
  it('parses LOG_LEVEL, defaulting to info', () => {
    expect([parseLogLevel('debug'), parseLogLevel('nonsense'), parseLogLevel(undefined)]).toEqual(['debug', 'info', 'info']);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

describe('audio and transcripts never touch disk in the bot', () => {
  it('only settings.ts writes files under src/', () => {
    const writers = walk('src')
      .filter((f) => /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/\\/g, '/'));
    expect(writers).toEqual(['src/settings.ts']);
  });
  it('the sidecar writes no audio files', () => {
    // wave.open(buf, "wb") on an in-memory buffer is fine; opening a path for writing is not.
    for (const f of walk('services/speech/app').filter((p) => p.endsWith('.py'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bopen\(\s*(?!buf\b)[^)]*['"][wa]b?['"]/);
      expect(src, f).not.toMatch(/write_bytes|write_text|\.save\(/);
    }
  });
});
