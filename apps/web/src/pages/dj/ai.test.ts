import { describe, expect, it } from 'vitest';
import type { AiPassResult, TransitionSettings } from '@curator/shared';
import {
  aiBannerText,
  aiChangedCount,
  BARS_16_NOTE,
  BARS_HIDDEN_NOTE,
  barsNote,
  countAiChanges,
  mergeAiResult,
  pairHints,
  pairKeys,
  settingsLine,
} from './ai.ts';
import { carryEdits, fromAi, isEdited } from './edits.ts';
import { sheetAsText } from './sheet.ts';
import { A, AUTO, B, C, CUSTOM, D, resultOf, track, transition } from './test-helpers.ts';

const ECHO: TransitionSettings = { ...CUSTOM, effects: 'Echo ½ out end' };
const DARK: TransitionSettings = { ...CUSTOM, filter: 'Low pass filter in' };
const USER: TransitionSettings = { ...CUSTOM, bars: 4 };

const aiResult = (entries: AiPassResult['transitions'], rejected: AiPassResult['rejected'] = []): AiPassResult => ({
  agent: 'claude',
  transitions: entries,
  rejected,
  set: null,
  summary: 'Darker blends at the peak',
  setName: 'Peak Hour Shadows',
});

describe('mergeAiResult', () => {
  it('sets ai on each pair and takes its settings unless the user edited the pair', () => {
    const prev = resultOf([A, B, C, D]);
    prev.transitions[1] = { ...prev.transitions[1]!, settings: USER };
    const merged = mergeAiResult(
      prev,
      aiResult([
        { index: 0, settings: ECHO, reason: 'Echo out the vocal.' },
        { index: 1, settings: DARK, reason: 'Darker.' },
        { index: 2, settings: CUSTOM, reason: 'Fine as it is.' },
      ]),
    );
    expect(merged.transitions[0]!.settings).toEqual(ECHO);
    expect(merged.transitions[0]!.ai).toEqual({ settings: ECHO, reason: 'Echo out the vocal.', agent: 'claude' });
    expect(fromAi(merged.transitions[0]!)).toBe(true);
    expect(isEdited(merged.transitions[0]!)).toBe(false);
    // The user's edit wins; the AI version is kept for the toggle.
    expect(merged.transitions[1]!.settings).toEqual(USER);
    expect(merged.transitions[1]!.ai?.settings).toEqual(DARK);
    expect(isEdited(merged.transitions[1]!)).toBe(true);
    expect(aiChangedCount(merged)).toBe(2);
    expect(prev.transitions[0]!.ai).toBeNull();
  });

  it('replaces an earlier AI value on a second pass', () => {
    const first = mergeAiResult(resultOf([A, B]), aiResult([{ index: 0, settings: ECHO, reason: '' }]));
    const second = mergeAiResult(first, aiResult([{ index: 0, settings: DARK, reason: '' }]));
    expect(second.transitions[0]!.settings).toEqual(DARK);
  });

  it('follows the pair keys when the preview rebuilt during the pass', () => {
    const before = resultOf([A, B, C]);
    const keys = pairKeys(before); // a>b, b>c
    const after = resultOf([C, A, B]); // c>a, a>b
    const r = aiResult([
      { index: 0, settings: ECHO, reason: '' },
      { index: 1, settings: DARK, reason: '' },
    ]);
    const merged = mergeAiResult(after, r, keys);
    expect(merged.transitions[1]!.settings).toEqual(ECHO); // a>b moved to index 1
    expect(merged.transitions[0]!.ai).toBeNull(); // b>c is gone
    expect(countAiChanges(after, r, keys)).toBe(1);
  });
});

describe('carryEdits with the AI pass', () => {
  it('keeps AI values and user edits on surviving pairs, and counts only user edits', () => {
    let prev = resultOf([A, B, C, D]);
    prev = mergeAiResult(
      prev,
      aiResult([
        { index: 0, settings: ECHO, reason: 'a' },
        { index: 2, settings: DARK, reason: 'c' },
      ]),
    );
    prev.transitions[1] = { ...prev.transitions[1]!, settings: USER }; // B → C edited
    const next = resultOf([D, A, B, C]); // A → B and B → C survive, C → D does not
    const { result, kept, dropped } = carryEdits(prev, next);
    expect(kept).toBe(1);
    expect(dropped).toBe(0);
    expect(result.transitions[1]!.settings).toEqual(ECHO);
    expect(result.transitions[1]!.ai?.reason).toBe('a');
    expect(result.transitions[2]!.settings).toEqual(USER);
    expect(result.transitions[0]!.ai).toBeNull();
  });

  it('takes fresh rules on a pair reset to rules, but keeps its AI version', () => {
    const prev = mergeAiResult(resultOf([A, B]), aiResult([{ index: 0, settings: ECHO, reason: '' }]));
    prev.transitions[0] = { ...prev.transitions[0]!, settings: CUSTOM };
    const next = resultOf([A, B], [transition(AUTO)]);
    const { result } = carryEdits(prev, next);
    expect(result.transitions[0]!.settings).toEqual(AUTO);
    expect(result.transitions[0]!.ai?.settings).toEqual(ECHO);
  });
});

describe('texts', () => {
  it('builds the banner text', () => {
    expect(aiBannerText('claude', 'Darker blends at the peak', 15, 1)).toBe(
      'AI pass by Claude Code: Darker blends at the peak · 15 changed · 1 rejected',
    );
    expect(aiBannerText('gemini', ' ', 0, 0)).toBe('AI pass by Gemini CLI · 0 changed');
  });

  it('describes settings in one line', () => {
    expect(settingsLine(ECHO)).toBe('8 bars · Custom · Smooth crossfade, Center bass swap, Echo ½ out end');
    expect(settingsLine(AUTO)).toBe('Auto');
  });

  it('warns about hidden bars only when bars are set', () => {
    expect(barsNote(transition(CUSTOM, { barsMayBeHidden: true }))).toBe(BARS_HIDDEN_NOTE);
    expect(barsNote(transition(AUTO, { barsMayBeHidden: true }))).toBeNull();
    expect(barsNote(transition(CUSTOM))).toBeNull();
    const text = sheetAsText(resultOf([A, B], [transition(CUSTOM, { barsMayBeHidden: true })]));
    expect(text).toContain(`      Bars: ${BARS_HIDDEN_NOTE}`);
  });

  it('says to fall back to 8 when Spotify does not offer 16 bars', () => {
    const sixteen = transition({ ...CUSTOM, bars: 16 });
    expect(barsNote(sixteen)).toBe(BARS_16_NOTE);
    // A hidden bar choice wins: there is nothing to pick at all.
    expect(barsNote(transition({ ...CUSTOM, bars: 16 }, { barsMayBeHidden: true }))).toBe(BARS_HIDDEN_NOTE);
    expect(sheetAsText(resultOf([A, B], [sixteen]))).toContain(`      Bars: ${BARS_16_NOTE}`);
  });

  it('marks AI pairs in the copied sheet', () => {
    const r = mergeAiResult(resultOf([A, B]), aiResult([{ index: 0, settings: ECHO, reason: '' }]));
    expect(sheetAsText(r)).toContain('    → 1 → 2 · 8 bars · Custom (AI)');
  });
});

describe('pairHints', () => {
  const vocal = { ...track('v', 'Get Lucky', 'Daft Punk'), instrumentalness: 0.01 };
  const instrumental = { ...track('i', 'Aerodynamic', 'Daft Punk'), instrumentalness: 0.9 };
  const acoustic = { ...track('k', 'Blackbird', 'The Beatles'), acousticness: 0.9 };

  it('names vocals, instrumentals and acoustic tracks', () => {
    expect(pairHints(vocal, vocal).map((h) => h.label)).toEqual(['vocals ↔ vocals']);
    expect(pairHints(instrumental, vocal).map((h) => h.label)).toEqual(['instrumental out']);
    expect(pairHints(vocal, acoustic).map((h) => h.label)).toEqual(['acoustic']);
    expect(pairHints(A, B)).toEqual([]);
  });
});
