import type { Llm, LlmTurn } from '../pipeline/types.js';
import type { ChatMessage } from './gemini.js';

/** Per-channel rolling history, bounded to `maxTurns` exchanges (one user line plus one reply each). */
export class ConversationMemory {
  private messages: ChatMessage[] = [];
  constructor(private readonly maxTurns: number) {}

  /** Records one exchange. The speaker's display name is tagged onto their line. */
  addExchange(speaker: string, said: string, reply: string): void {
    this.messages.push({ role: 'user', text: `${speaker}: ${said}` }, { role: 'model', text: reply });
    const max = this.maxTurns * 2;
    if (this.messages.length > max) this.messages = this.messages.slice(this.messages.length - max);
  }

  history(): ChatMessage[] {
    return [...this.messages];
  }

  /** Called on /leave: a new call starts with a clean slate. */
  clear(): void {
    this.messages = [];
  }

  get size(): number {
    return this.messages.length / 2;
  }
}

/** Wraps an Llm so finished replies are remembered. Aborted or empty replies are not; a reply cut short by the length cap is. */
export function withMemory(inner: Llm, memory: ConversationMemory): Llm {
  return {
    async *stream(turn: LlmTurn, signal?: AbortSignal): AsyncIterable<string> {
      let reply = '';
      try {
        for await (const delta of inner.stream(turn, signal)) {
          reply += delta;
          yield delta;
        }
      } finally {
        // Also runs when the consumer stops early (length cap); an aborted turn is not remembered.
        if (!signal?.aborted && reply.trim()) memory.addExchange(turn.speaker, turn.text, reply.trim());
      }
    },
  };
}
