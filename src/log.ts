export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Shapes of keys we use, so a secret is caught even if it was never registered. */
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /[MNO][A-Za-z\d_-]{23,27}\.[\w-]{6}\.[\w-]{27,}/g, // Discord bot tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];

/** Replaces known secret values and key-shaped strings. Used on every log line. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join('[redacted]');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  /** True when debug lines are shown, so callers can skip building them. */
  readonly debugOn: boolean;
}

export interface LoggerOptions {
  level?: LogLevel;
  secrets?: readonly string[];
  write?: (level: LogLevel, line: string) => void;
}

/**
 * Leveled logger that redacts secrets. Transcripts (what people said, what the bot said) are logged at
 * debug level only, so a normal run keeps no record of conversations.
 */
export function createLogger(o: LoggerOptions = {}): Logger {
  const min = ORDER[o.level ?? 'info'];
  const write =
    o.write ??
    ((level, line) => {
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    });
  const emit = (level: LogLevel, msg: string): void => {
    if (ORDER[level] >= min) write(level, redactSecrets(msg, o.secrets));
  };
  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
    debugOn: min === 0,
  };
}

export function parseLogLevel(v: string | undefined): LogLevel {
  return v === 'debug' || v === 'warn' || v === 'error' ? v : 'info';
}
