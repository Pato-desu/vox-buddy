import { readFileSync, writeFileSync } from 'node:fs';

export type VoiceKind = 'fast' | 'clone';

/** User-changeable settings persisted in settings.json (git-ignored). */
export interface Settings {
  voice: VoiceKind;
  /** Name of the selected clone sample in voices/, if any. */
  cloneSample: string | null;
  /** Voice channel to join on start, if any (D8). */
  autoJoinChannelId: string | null;
  /** Text channel that gets heard/said lines (D10); null = off. */
  mirrorChannelId: string | null;
}

export const defaultSettings: Settings = { voice: 'fast', cloneSample: null, autoJoinChannelId: null, mirrorChannelId: null };

export interface SettingsIo {
  read: (path: string) => string;
  write: (path: string, text: string) => void;
}

const fsIo: SettingsIo = { read: (p) => readFileSync(p, 'utf8'), write: (p, t) => writeFileSync(p, t) };

/** Keeps only known keys with the right type; anything else falls back to the default. */
export function normalizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    voice: o.voice === 'clone' ? 'clone' : 'fast',
    cloneSample: str(o.cloneSample),
    autoJoinChannelId: str(o.autoJoinChannelId),
    mirrorChannelId: str(o.mirrorChannelId),
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
