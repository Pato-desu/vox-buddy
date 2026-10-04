import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATTERNS: [string, RegExp][] = [
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['Discord bot token', /[MNO][A-Za-z\d_-]{23,27}\.[\w-]{6}\.[\w-]{27,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['assigned secret', /(DISCORD_TOKEN|GOOGLE_API_KEY)[ \t]*=[ \t]*[^\s#]{8,}/],
];

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter((f) => f && !/\.(png|jpg|wav|onnx|lock)$|package-lock\.json$/.test(f));
}

describe('secrets hygiene', () => {
  it('no tracked file contains a key- or token-shaped string (this test file builds its patterns, not values)', () => {
    const hits: string[] = [];
    for (const f of trackedFiles()) {
      if (f === 'tests/secrets.test.ts' || f === 'tests/privacy.test.ts') continue; // privacy.test builds fake values at runtime
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue; // deleted in the working tree
      }
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('.env is git-ignored and never tracked; .env.example holds no values', () => {
    expect(readFileSync('.gitignore', 'utf8').split(/\r?\n/)).toContain('.env');
    expect(trackedFiles()).not.toContain('.env');
    for (const line of readFileSync('.env.example', 'utf8').split(/\r?\n/)) {
      if (/^[A-Z_]+=/.test(line)) expect(line, line).toMatch(/^[A-Z_]+=$|^[A-Z_]+=https?:\/\/127\.0\.0\.1/);
    }
  });

  it('startup logging only shows redacted secrets', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain('redact(env.discordToken)');
    expect(main).not.toMatch(/(info|log|error|warn)\([^)]*env\.(discordToken|googleApiKey)(?!\))/s);
    expect(main).toContain('secrets: [env.discordToken, env.googleApiKey]');
  });
});
