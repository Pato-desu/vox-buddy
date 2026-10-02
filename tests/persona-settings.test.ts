import { describe, expect, it } from 'vitest';
import { PersonaStore, defaultPersona } from '../src/persona.js';
import { SettingsStore, defaultSettings, normalizeSettings } from '../src/settings.js';

describe('PersonaStore', () => {
  it('loads the file, and reload picks up edits', () => {
    let file = 'You are Zed.';
    const store = new PersonaStore('persona.md', 'Buddy', () => file);
    expect(store.get()).toBe('You are Zed.');
    file = '  You are Zed, louder.  ';
    expect(store.reload()).toBe('You are Zed, louder.');
  });
  it('falls back to the default when missing or empty', () => {
    const missing = new PersonaStore('x', 'Buddy', () => {
      throw new Error('ENOENT');
    });
    expect(missing.get()).toBe(defaultPersona('Buddy'));
    expect(new PersonaStore('x', 'Buddy', () => '  \n').get()).toBe(defaultPersona('Buddy'));
  });
});

describe('SettingsStore', () => {
  const mem = (initial?: string) => {
    const files: Record<string, string> = initial === undefined ? {} : { 's.json': initial };
    return {
      files,
      io: {
        read: (p: string) => {
          if (!(p in files)) throw new Error('ENOENT');
          return files[p]!;
        },
        write: (p: string, t: string) => void (files[p] = t),
      },
    };
  };
  it('returns defaults when the file is missing or corrupt', () => {
    expect(new SettingsStore('s.json', mem().io).get()).toEqual(defaultSettings);
    expect(new SettingsStore('s.json', mem('{nope').io).get()).toEqual(defaultSettings);
  });
  it('writes updates and reads them back', () => {
    const m = mem();
    new SettingsStore('s.json', m.io).update({ voice: 'clone', cloneSample: 'me' });
    const again = new SettingsStore('s.json', m.io).get();
    expect(again).toEqual({ voice: 'clone', cloneSample: 'me', autoJoinChannelId: null });
  });
  it('drops unknown keys and bad types', () => {
    expect(normalizeSettings({ voice: 'robot', cloneSample: 5, extra: 1 })).toEqual(defaultSettings);
  });
});
