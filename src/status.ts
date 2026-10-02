import type { RollingSummary } from './pipeline/metrics.js';
import type { Settings } from './settings.js';

export interface StatusInfo {
  channelName: string | null;
  hushed: boolean;
  settings: Pick<Settings, 'voice' | 'cloneSample'>;
  sidecar: { ok: boolean; stt?: string | undefined; tts?: string | undefined };
  latency: RollingSummary;
}

/** The text behind /status: short lines, no secrets. */
export function formatStatus(s: StatusInfo): string {
  const lines = [
    `Channel: ${s.channelName ?? 'not in a voice channel'}${s.hushed ? ' (hushed)' : ''}`,
    `Voice: ${s.settings.voice}${s.settings.voice === 'clone' && s.settings.cloneSample ? ` (${s.settings.cloneSample})` : ''}`,
    s.sidecar.ok ? `Speech sidecar: ok${s.sidecar.stt ? `, stt ${s.sidecar.stt}` : ''}${s.sidecar.tts ? `, tts ${s.sidecar.tts}` : ''}` : 'Speech sidecar: DOWN',
  ];
  if (s.latency) {
    const fw = s.latency.firstWordMs;
    lines.push(
      `First word: avg ${fw.avg} ms, median ${fw.p50} ms, worst ${fw.max} ms over ${fw.count} turn(s)`,
      `Stages (avg): hear ${s.latency.sttMs.avg} ms, think ${s.latency.firstLlmSentenceMs.avg} ms, voice ${s.latency.firstTtsAudioMs.avg} ms`,
    );
  } else lines.push('Latency: no replies yet');
  return lines.join('\n');
}
