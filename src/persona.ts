import { readFileSync } from 'node:fs';

/** Built-in system prompt (SPEC §6), used when persona.md is missing or empty. */
export function defaultPersona(name: string): string {
  return (
    `You are ${name}, a quick-witted friend in a Discord voice call. Speak in 1-2 short sentences, casual, funny but kind. ` +
    `Never use lists, markdown, emoji or stage directions. You hear several people; their names are given. ` +
    `If you didn't catch something, say so.`
  );
}

export type ReadText = (path: string) => string;

/** Holds the current persona text. `reload()` re-reads persona.md; a missing or empty file falls back to the default. */
export class PersonaStore {
  private text: string;
  constructor(
    private readonly path: string,
    private readonly name: string,
    private readonly read: ReadText = (p) => readFileSync(p, 'utf8'),
  ) {
    this.text = this.load();
  }

  private load(): string {
    try {
      const t = this.read(this.path).trim();
      if (t) return t;
    } catch {
      /* missing file: use the default */
    }
    return defaultPersona(this.name);
  }

  get(): string {
    return this.text;
  }

  reload(): string {
    this.text = this.load();
    return this.text;
  }
}
