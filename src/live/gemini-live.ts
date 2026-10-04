import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type { LiveConnection, LiveConnector, LiveEvents } from './types.js';

export const SEND_CHUNK_SAMPLES = 3200; // 200 ms at 16 kHz

const toBase64 = (pcm: Int16Array): string => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');

export function fromBase64(data: string): Int16Array {
  const buf = Buffer.from(data, 'base64');
  const out = new Int16Array(Math.floor(buf.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

/** Turns one wire message into events. Audio comes first so a message that also ends the turn plays its last words. */
export function dispatchServerMessage(m: LiveServerMessage, ev: LiveEvents): void {
  const c = m.serverContent;
  if (c?.interrupted) ev.onInterrupted();
  for (const part of c?.modelTurn?.parts ?? []) {
    if (part.inlineData?.data) ev.onAudio(fromBase64(part.inlineData.data));
  }
  if (c?.inputTranscription?.text) ev.onInputText(c.inputTranscription.text);
  if (c?.outputTranscription?.text) ev.onOutputText(c.outputTranscription.text);
  if (c?.turnComplete) ev.onTurnComplete();
  const update = m.sessionResumptionUpdate;
  if (update?.newHandle && update.resumable !== false) ev.onResumeHandle(update.newHandle);
  if (m.goAway) ev.onGoAway();
}

/**
 * Real connector over the Gemini Live API. Voice activity detection is off: the bot already knows, per person, where an
 * utterance starts and ends, so it marks the activity itself and the model never hears two people blended together.
 */
export function createGeminiLiveConnector(apiKey: string): LiveConnector {
  const ai = new GoogleGenAI({ apiKey });
  return async (o, ev) => {
    const session = await ai.live.connect({
      model: o.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: o.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice } } },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} }, // hours-long calls must not hit the context limit
        sessionResumption: o.resumeHandle ? { handle: o.resumeHandle } : {},
      },
      callbacks: {
        onmessage: (m) => dispatchServerMessage(m, ev),
        onerror: (e) => ev.onClose(e.message || 'connection error'),
        onclose: (e) => ev.onClose(e.reason || undefined),
      },
    });
    const conn: LiveConnection = {
      startActivity: () => session.sendRealtimeInput({ activityStart: {} }),
      sendText: (text) => session.sendRealtimeInput({ text }),
      sendAudio: (pcm) => {
        for (let i = 0; i < pcm.length; i += SEND_CHUNK_SAMPLES) {
          session.sendRealtimeInput({ audio: { data: toBase64(pcm.subarray(i, i + SEND_CHUNK_SAMPLES)), mimeType: 'audio/pcm;rate=16000' } });
        }
      },
      endActivity: () => session.sendRealtimeInput({ activityEnd: {} }),
      close: () => session.close(),
    };
    return conn;
  };
}
