/** Spoken replies stay short: the prompt asks for 1-2 sentences, this is the hard cap. */
export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Tracks words across a streamed reply. `take(sentence)` returns the sentence to speak, or null once the cap is
 * reached. The sentence that crosses the cap is dropped unless it is the first one, which is cut at a word boundary.
 */
export class ReplyLimiter {
  private words = 0;
  private done = false;
  constructor(private readonly hardCap: number) {}

  get capped(): boolean {
    return this.done;
  }

  take(sentence: string): string | null {
    if (this.done) return null;
    const n = wordCount(sentence);
    if (this.words + n <= this.hardCap) {
      this.words += n;
      return sentence;
    }
    this.done = true;
    if (this.words > 0) return null; // cut at the sentence boundary before it
    const cut = sentence.split(/\s+/).filter(Boolean).slice(0, this.hardCap).join(' ');
    return cut.replace(/[,;:\-–]+$/, '') + '.';
  }
}
