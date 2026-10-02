import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv, redact, tuning } from '../src/config.js';

describe('config', () => {
  it('holds the SPEC §5 numbers', () => {
    expect(tuning.silenceEndMs).toBe(800);
    expect(tuning.minUtteranceMs).toBe(400);
    expect(tuning.maxUtteranceMs).toBe(20_000);
    expect(tuning.botTurnGapMs).toBe(1500);
    expect(tuning.historyTurns).toBe(20);
    expect(tuning.replyWordHardCap).toBe(80);
    expect(tuning.bargeInStopMs).toBe(300);
    expect(tuning.cloneIdleUnloadS).toBe(600);
    expect(tuning.ttsSentenceMinChars).toBe(12);
    expect(tuning.geminiTemperature).toBe(0.9);
  });

  it('loads a complete env', () => {
    const env = loadEnv({ DISCORD_TOKEN: ' t ', GOOGLE_API_KEY: 'k', GUILD_ID: '1' });
    expect(env).toEqual({ discordToken: 't', googleApiKey: 'k', guildId: '1' });
  });

  it('reports missing names without values', () => {
    try {
      loadEnv({ DISCORD_TOKEN: 'secret-token', GOOGLE_API_KEY: '' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as Error).message;
      expect(msg).toContain('GOOGLE_API_KEY');
      expect(msg).toContain('GUILD_ID');
      expect(msg).not.toContain('secret-token');
    }
  });

  it('redacts values', () => {
    expect(redact('abcdef')).toBe('***(6 chars)');
    expect(redact('')).toBe('(empty)');
  });
});
