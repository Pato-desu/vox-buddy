import { describe, expect, it } from 'vitest';
import { SentenceSplitter, cleanForSpeech } from '../src/pipeline/sentences.js';

function split(deltas: string[], min = 12): string[] {
  const s = new SentenceSplitter(min);
  return [...deltas.flatMap((d) => s.push(d)), ...s.flush()];
}

describe('SentenceSplitter', () => {
  it.each([
    [['Hello there my friend. How are you doing today?'], ['Hello there my friend.', 'How are you doing today?']],
    [['Hello the', 're my friend', '. Next one comes right here!'], ['Hello there my friend.', 'Next one comes right here!']],
    [['Mr. Smith went to town today. Fun times ahead.'], ['Mr. Smith went to town today.', 'Fun times ahead.']],
    [['It costs 3.5 dollars today, wow. Okay then friend.'], ['It costs 3.5 dollars today, wow.', 'Okay then friend.']],
    [['Well... I think so, honestly. Yeah.'], ['Well... I think so, honestly.', 'Yeah.']],
    [['Hi. That is a very long sentence indeed.'], ['Hi. That is a very long sentence indeed.']],
    [['No terminal punctuation here'], ['No terminal punctuation here']],
  ])('%j', (deltas, expected) => {
    expect(split(deltas)).toEqual(expected);
  });
});

describe('cleanForSpeech', () => {
  it.each([
    ['**bold** text', 'bold text'],
    ['Haha *laughs* nice one', 'Haha nice one'],
    ['Great 😄 job 🎉', 'Great job'],
    ['See https://example.com/x now', 'See now'],
    ['# Title\n- item one\n- item two', 'Title item one item two'],
    ['`code` here', 'code here'],
  ])('%j', (input, expected) => {
    expect(cleanForSpeech(input)).toBe(expected);
  });
});
