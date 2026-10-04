const FILLERS = new Set(['uh', 'um', 'uhm', 'umm', 'er', 'erm', 'eh', 'ah', 'hm', 'hmm', 'hmmm', 'mm', 'mmm', 'mhm', 'huh', 'oh', 'uh-huh']);

const wordsOf = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * True when a short utterance (at most `maxWords` words) contains the leave phrase, ignoring case and punctuation:
 * "Parrot, leave." and "ok parrot leave now" match, a long sentence that merely mentions it does not.
 */
export function isLeaveCommand(text: string, phrase: string, maxWords = 6): boolean {
  const heard = wordsOf(text);
  const want = wordsOf(phrase);
  if (want.length === 0 || heard.length > maxWords) return false;
  for (let i = 0; i + want.length <= heard.length; i++) if (want.every((w, k) => heard[i + k] === w)) return true;
  return false;
}

export type JunkReason ='empty' | 'one word' | 'filler only';

/**
 * Why a transcript is not worth a reply, or null when it is: empty, a single word (unless the bot just asked something),
 * or only filler sounds. Whisper also hallucinates bracketed tags like "[BLANK_AUDIO]" or "(music)" on noise.
 * The reason never contains the transcript itself, so it is safe to log.
 */
export function junkReason(text: string, opts: { expectingAnswer?: boolean } = {}): JunkReason | null {
  const cleaned = text.replace(/[[(][^\])]*[\])]/g, ' ').toLowerCase();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
  if (words.length === 1 && opts.expectingAnswer) return FILLERS.has(words[0]!) ? 'filler only' : null; // "yes" is a fine answer to a question
  if (words.length === 0) return 'empty';
  if (words.length === 1) return 'one word';
  return words.every((w) => FILLERS.has(w)) ? 'filler only' : null;
}

export function isJunkTranscript(text: string, opts: { expectingAnswer?: boolean } = {}): boolean {
  return junkReason(text, opts) !== null;
}
