import { GoogleGenAI } from '@google/genai';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiRequest {
  model: string;
  systemInstruction: string;
  temperature: number;
  history: ChatMessage[];
  signal?: AbortSignal;
}

/** One streamed piece from the API, already reduced to what we care about. */
export interface TransportChunk {
  text?: string;
  /** Set when the prompt or reply was blocked (e.g. SAFETY). */
  blockReason?: string;
}

export type Transport = (req: GeminiRequest) => AsyncIterable<TransportChunk>;

export type GeminiEvent =
  | { type: 'text'; text: string }
  | { type: 'blocked'; reason: string }
  | { type: 'error'; kind: 'rate_limit' | 'server' | 'auth' | 'aborted' | 'unknown'; message: string };

export function classifyError(e: unknown): Extract<GeminiEvent, { type: 'error' }> {
  const err = e as { status?: number; code?: number; name?: string; message?: string };
  const status = err?.status ?? err?.code;
  const message = err?.message ?? String(e);
  if (err?.name === 'AbortError') return { type: 'error', kind: 'aborted', message };
  if (status === 429) return { type: 'error', kind: 'rate_limit', message };
  if (status === 401 || status === 403) return { type: 'error', kind: 'auth', message };
  if (typeof status === 'number' && status >= 500) return { type: 'error', kind: 'server', message };
  return { type: 'error', kind: 'unknown', message };
}

/** Streams a reply as typed events. Never throws: failures become events. */
export async function* streamReply(transport: Transport, req: GeminiRequest): AsyncGenerator<GeminiEvent> {
  try {
    for await (const chunk of transport(req)) {
      if (chunk.blockReason) {
        yield { type: 'blocked', reason: chunk.blockReason };
        return;
      }
      if (chunk.text) yield { type: 'text', text: chunk.text };
    }
  } catch (e) {
    yield classifyError(e);
  }
}

/** Real transport over @google/genai. Sends transcript text only, never audio. */
export function createGenAiTransport(apiKey: string): Transport {
  const ai = new GoogleGenAI({ apiKey });
  return async function* (req) {
    const stream = await ai.models.generateContentStream({
      model: req.model,
      contents: req.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: {
        systemInstruction: req.systemInstruction,
        temperature: req.temperature,
        abortSignal: req.signal,
      },
    });
    for await (const chunk of stream) {
      const blockReason = chunk.promptFeedback?.blockReason ?? undefined;
      const finish = chunk.candidates?.[0]?.finishReason;
      if (blockReason) yield { blockReason: String(blockReason) };
      else if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') yield { blockReason: String(finish) };
      else yield { text: chunk.text ?? '' };
    }
  };
}
