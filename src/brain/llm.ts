import type { Llm, LlmTurn } from '../pipeline/types.js';
import { streamReply, type ChatMessage, type TokenUsage, type Transport } from './gemini.js';

export interface GeminiLlmOptions {
  transport: Transport;
  model: string;
  temperature: number;
  persona: string | (() => string);
  /** Spoken when the reply is blocked or the API fails. */
  blockedLine: string;
  errorLine: string;
  history?: () => ChatMessage[];
  /** Per-failure apologies in the persona's voice; `errorLine` covers the rest. */
  lines?: Partial<Record<'rate_limit' | 'server' | 'auth', string>>;
  /** The same failure within this window stays silent instead of apologising again. Default 30 s. */
  apologyCooldownMs?: number;
  now?: () => number;
  /** Called once per request with the tokens Gemini reported (also when the reply was cut short). */
  onUsage?: (u: TokenUsage) => void;
}

export type FailureKind = 'blocked' | 'rate_limit' | 'server' | 'auth' | 'unknown';

/** Gemini behind the Llm interface. Failures turn into one short spoken line, not exceptions. */
export class GeminiLlm implements Llm {
  private lastApology = new Map<FailureKind, number>();

  constructor(private readonly o: GeminiLlmOptions) {}

  async *stream(turn: LlmTurn, signal?: AbortSignal): AsyncIterable<string> {
    const persona = typeof this.o.persona === 'function' ? this.o.persona() : this.o.persona;
    const history: ChatMessage[] = [...(this.o.history?.() ?? []), { role: 'user', text: `${turn.speaker}: ${turn.text}` }];
    let usage: TokenUsage | undefined; // cumulative, so the last report is the total
    try {
      for await (const ev of streamReply(this.o.transport, {
        model: this.o.model,
        systemInstruction: persona,
        temperature: this.o.temperature,
        history,
        signal,
      })) {
        if (ev.type === 'usage') {
          usage = { promptTokens: ev.promptTokens, outputTokens: ev.outputTokens, thinkingTokens: ev.thinkingTokens };
        } else if (ev.type === 'text') {
          this.lastApology.clear(); // recovered: the next failure gets a fresh apology
          yield ev.text;
        } else if (ev.type === 'blocked') return void (yield* this.apologise('blocked', this.o.blockedLine));
        else if (ev.kind === 'aborted') return;
        else {
          const kind: FailureKind = ev.kind;
          return void (yield* this.apologise(kind, (kind !== 'unknown' && this.o.lines?.[kind]) || this.o.errorLine));
        }
      }
    } finally {
      if (usage) this.o.onUsage?.(usage);
    }
  }

  /** One apology per failure kind per cooldown: a dead API never turns into a loop of sorries. */
  private *apologise(kind: FailureKind, line: string): Generator<string> {
    const now = (this.o.now ?? Date.now)();
    const last = this.lastApology.get(kind);
    if (last !== undefined && now - last < (this.o.apologyCooldownMs ?? 30_000)) return;
    this.lastApology.set(kind, now);
    yield line;
  }
}
