import type { Llm, LlmTurn } from '../pipeline/types.js';
import { streamReply, type ChatMessage, type Transport } from './gemini.js';

export interface GeminiLlmOptions {
  transport: Transport;
  model: string;
  temperature: number;
  persona: string | (() => string);
  /** Spoken when the reply is blocked or the API fails. */
  blockedLine: string;
  errorLine: string;
  history?: () => ChatMessage[];
}

/** Gemini behind the Llm interface. Failures turn into one short spoken line, not exceptions. */
export class GeminiLlm implements Llm {
  constructor(private readonly o: GeminiLlmOptions) {}

  async *stream(turn: LlmTurn, signal?: AbortSignal): AsyncIterable<string> {
    const persona = typeof this.o.persona === 'function' ? this.o.persona() : this.o.persona;
    const history: ChatMessage[] = [...(this.o.history?.() ?? []), { role: 'user', text: `${turn.speaker}: ${turn.text}` }];
    for await (const ev of streamReply(this.o.transport, {
      model: this.o.model,
      systemInstruction: persona,
      temperature: this.o.temperature,
      history,
      signal,
    })) {
      if (ev.type === 'text') yield ev.text;
      else if (ev.type === 'blocked') return void (yield this.o.blockedLine);
      else if (ev.kind === 'aborted') return;
      else return void (yield this.o.errorLine);
    }
  }
}
