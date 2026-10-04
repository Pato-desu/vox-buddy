/** Tunable numbers from SPEC §5. Secrets come from the environment, never from here. */
export type BargeInMode = 'stop' | 'sentence' | 'never';

export interface Tuning {
  silenceEndMs: number;
  minUtteranceMs: number;
  maxUtteranceMs: number;
  energyGate: number;
  botTurnGapMs: number;
  historyTurns: number;
  replyWordTarget: number;
  replyWordHardCap: number;
  bargeInStopMs: number;
  /** D5: 'stop' drops the reply at once (default), 'sentence' finishes the playing sentence, 'never' ignores interruptions. */
  bargeInMode: BargeInMode;
  cloneIdleUnloadS: number;
  ttsSentenceMinChars: number;
  geminiModel: string;
  geminiTemperature: number;
  latencyBudgetMs: { stt: number; firstLlmSentence: number; firstTtsAudio: number; firstWord: number };
  autoLeaveAloneS: number;
  botName: string;
}

export const tuning: Tuning = {
  silenceEndMs: 800,
  minUtteranceMs: 400,
  maxUtteranceMs: 20_000,
  energyGate: 500,
  botTurnGapMs: 1500,
  historyTurns: 20,
  replyWordTarget: 40,
  replyWordHardCap: 80,
  bargeInStopMs: 300,
  bargeInMode: 'stop',
  cloneIdleUnloadS: 600,
  ttsSentenceMinChars: 12,
  geminiModel: 'gemini-3.5-flash-lite', // gemini-2.5-flash is closed to new users (404); the bigger 3.x flash models were too slow to first word
  geminiTemperature: 0.9,
  latencyBudgetMs: { stt: 600, firstLlmSentence: 700, firstTtsAudio: 400, firstWord: 2000 },
  autoLeaveAloneS: 300,
  botName: 'Buddy',
};

export interface Env {
  discordToken: string;
  googleApiKey: string;
  guildId: string;
}

const REQUIRED = {
  DISCORD_TOKEN: 'discordToken',
  GOOGLE_API_KEY: 'googleApiKey',
  GUILD_ID: 'guildId',
} as const;

export class EnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing environment variables: ${missing.join(', ')}`);
    this.name = 'EnvError';
  }
}

/** Validates required variables. Error messages carry names only, never values. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing: string[] = [];
  const out: Partial<Env> = {};
  for (const [name, key] of Object.entries(REQUIRED) as [keyof typeof REQUIRED, keyof Env][]) {
    const value = source[name]?.trim();
    if (!value) missing.push(name);
    else out[key] = value;
  }
  if (missing.length > 0) throw new EnvError(missing);
  return out as Env;
}

/** Shows an env value safely for logs: never the secret itself. */
export function redact(value: string): string {
  return value.length === 0 ? '(empty)' : `***(${value.length} chars)`;
}
