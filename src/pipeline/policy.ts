const FILLERS = new Set(['uh', 'um', 'uhm', 'umm', 'er', 'erm', 'eh', 'ah', 'hm', 'hmm', 'hmmm', 'mm', 'mmm', 'mhm', 'huh', 'oh', 'uh-huh']);

/**
 * Junk transcripts are not worth a reply: empty, a single word, or only filler sounds.
 * Whisper also hallucinates bracketed tags like "[BLANK_AUDIO]" or "(music)" on noise.
 */
export function isJunkTranscript(text: string): boolean {
  const cleaned = text.replace(/[[(][^\])]*[\])]/g, ' ').toLowerCase();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
  if (words.length < 2) return true;
  return words.every((w) => FILLERS.has(w));
}
