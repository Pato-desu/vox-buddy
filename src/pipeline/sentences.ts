/** Turns streamed LLM text into speakable sentences, and strips what TTS must not read. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e']);

/** Removes markdown, emoji, *actions*, and URLs; collapses whitespace. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*[^*\n]+\*/g, ' ')
    .replace(/[*_`#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\u200d|\ufe0f/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBoundary(buf: string, i: number): boolean {
  const ch = buf[i];
  if (ch === '!' || ch === '?') return true;
  if (ch === '…') return true;
  if (ch !== '.') return false;
  // Ellipsis dots: only the last dot of "..." can end a sentence.
  if (buf[i + 1] === '.') return false;
  // Decimal numbers like 3.5
  if (/\d/.test(buf[i - 1] ?? '') && /\d/.test(buf[i + 1] ?? '')) return false;
  // Abbreviations like "Mr."
  const word = /([A-Za-z.]+)$/.exec(buf.slice(0, i))?.[1]?.toLowerCase();
  if (word && ABBREVIATIONS.has(word)) return false;
  return true;
}

export class SentenceSplitter {
  private buf = '';

  constructor(private readonly minChars: number) {}

  /** Feed a delta; returns the sentences completed by it. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      if (!isBoundary(this.buf, i)) continue;
      // Boundary must be followed by whitespace (or more punctuation) to be sure it is the end.
      let end = i + 1;
      while (end < this.buf.length && /["')\]]/.test(this.buf[end] ?? '')) end++;
      if (end >= this.buf.length) break; // wait for the next delta
      if (!/\s/.test(this.buf[end] ?? '')) continue;
      const sentence = cleanForSpeech(this.buf.slice(start, end));
      if (sentence.length >= this.minChars) {
        out.push(sentence);
        start = end;
      }
      i = end - 1;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** Emits whatever is left once the stream ends. */
  flush(): string[] {
    const rest = cleanForSpeech(this.buf);
    this.buf = '';
    return rest.length > 0 ? [rest] : [];
  }
}
