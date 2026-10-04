import type { TokenUsage } from './brain/gemini.js';

export interface UsageTotals {
  /** Gemini requests that reported token counts. */
  requests: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

/** Totals for one local calendar day; this is what gets persisted. */
export interface DayUsage extends UsageTotals {
  day: string;
}

export interface UsageStore {
  load: () => DayUsage | null;
  save: (d: DayUsage) => void;
}

export interface UsageSnapshot {
  run: UsageTotals;
  today: DayUsage;
  lastMinute: UsageTotals;
}

const zero = (): UsageTotals => ({ requests: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0 });
const add = (t: UsageTotals, u: TokenUsage): void => {
  t.requests++;
  t.promptTokens += u.promptTokens;
  t.outputTokens += u.outputTokens;
  t.thinkingTokens += u.thinkingTokens;
};

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Normalises whatever was stored: wrong shapes and negative or non-numeric counts become a fresh day. */
export function normalizeDayUsage(raw: unknown, today: string): DayUsage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  if (o.day !== today) return { day: today, ...zero() };
  return { day: today, requests: n(o.requests), promptTokens: n(o.promptTokens), outputTokens: n(o.outputTokens), thinkingTokens: n(o.thinkingTokens) };
}

/**
 * Counts the tokens the bot spends on Gemini: this run, today (survives restarts via `store`) and the last minute
 * (for comparing against per-minute limits). Counts only: no text is ever kept.
 */
export class UsageTracker {
  private readonly run = zero();
  private recent: { at: number; u: TokenUsage }[] = [];
  private today: DayUsage;

  constructor(private readonly store?: UsageStore, private readonly now: () => number = Date.now) {
    this.today = normalizeDayUsage(store?.load(), dayKey(now()));
  }

  record(u: TokenUsage): void {
    const t = this.now();
    this.rollDay(t);
    add(this.run, u);
    add(this.today, u);
    this.recent.push({ at: t, u });
    this.store?.save({ ...this.today });
  }

  snapshot(): UsageSnapshot {
    const t = this.now();
    this.rollDay(t);
    this.recent = this.recent.filter((r) => t - r.at < 60_000);
    const lastMinute = zero();
    for (const r of this.recent) add(lastMinute, r.u);
    return { run: { ...this.run }, today: { ...this.today }, lastMinute };
  }

  private rollDay(t: number): void {
    const key = dayKey(t);
    if (this.today.day !== key) this.today = { day: key, ...zero() };
  }
}

const num = (n: number): string => n.toLocaleString('en-US');
const tokens = (t: UsageTotals): number => t.promptTokens + t.outputTokens + t.thinkingTokens;
const describe = (t: UsageTotals): string => {
  const out = t.outputTokens + t.thinkingTokens;
  const think = t.thinkingTokens > 0 ? ` (${num(t.thinkingTokens)} of it thinking)` : '';
  return `${num(t.requests)} repl${t.requests === 1 ? 'y' : 'ies'}, ${num(tokens(t))} tokens (${num(t.promptTokens)} in, ${num(out)} out${think})`;
};

/** The text behind /usage. */
export function formatUsage(s: UsageSnapshot, model: string): string {
  const lines = [`Gemini model: ${model}`, `This run: ${describe(s.run)}`, `Today (local time): ${describe(s.today)}`, `Last minute: ${describe(s.lastMinute)}`];
  if (s.run.requests > 0) lines.push(`Average reply this run: about ${num(Math.round(tokens(s.run) / s.run.requests))} tokens`);
  lines.push('Counts only what this bot sent. Google gives no way to read a remaining balance with an API key; limits and totals for the whole key are at https://aistudio.google.com/usage');
  return lines.join('\n');
}
