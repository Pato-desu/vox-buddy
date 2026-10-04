import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeDayUsage, type DayUsage } from './usage.js';

export type VoiceKind = 'fast' | 'clone';

/** classic = local speech + Gemini text; live = one cloud Gemini Live session hears and speaks (audio leaves the PC). */
export type Mode = 'classic' | 'live';

/** User-changeable settings persisted in settings.json (git-ignored). */
export interface Settings {
  voice: VoiceKind;
  /** Which pipeline runs on the next /join (see Mode). */
  mode: Mode;
  /** Name of the selected clone sample in voices/, if any. */
  cloneSample: string | null;
  /** Voice channel to join on start, if any (D8). */
  autoJoinChannelId: string | null;
  /** /hush state, kept across restarts. */
  hushed: boolean;
  /** Text channel that gets heard/said lines (D10); null = off. */
  mirrorChannelId: string | null;
  /** Gemini token counts for the current local day (counts only, no text); see /usage. */
  usage: DayUsage | null;
}

export const defaultSettings: Settings = { voice: 'fast', mode: 'classic', cloneSample: null, autoJoinChannelId: null, mirrorChannelId: null, hushed: false, usage: null };

export interface SettingsIo {
  read: (path: string) => string;
  write: (path: string, text: string) => void;
}

const fsIo: SettingsIo = { read: (p) => readFileSync(p, 'utf8'), write: (p, t) => writeFileSync(p, t) };

const dayUsage = (v: unknown): DayUsage | null => {
  const day = (v as { day?: unknown } | null | undefined)?.day;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? normalizeDayUsage(v, day) : null;
};

/** Keeps only known keys with the right type; anything else falls back to the default. */
export function normalizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    voice: o.voice === 'clone' ? 'clone' : 'fast',
    mode: o.mode === 'live' ? 'live' : 'classic',
    cloneSample: str(o.cloneSample),
    autoJoinChannelId: str(o.autoJoinChannelId),
    mirrorChannelId: str(o.mirrorChannelId),
    hushed: o.hushed === true,
    usage: dayUsage(o.usage),
  };
}

export class SettingsStore {
  private value: Settings;
  constructor(private readonly path: string, private readonly io: SettingsIo = fsIo) {
    this.value = this.load();
  }

  private load(): Settings {
    try {
      return normalizeSettings(JSON.parse(this.io.read(this.path)));
    } catch {
      return { ...defaultSettings }; // missing or corrupt file: defaults
    }
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>): Settings {
    this.value = normalizeSettings({ ...this.value, ...patch });
    this.io.write(this.path, JSON.stringify(this.value, null, 2) + '\n');
    return this.value;
  }
}
