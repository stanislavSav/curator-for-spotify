import { describe, expect, it } from 'vitest';
import type { DjSetRecord } from '@curator/shared';
import { carryEdits, isEdited, pairTitle, patchRecord, presetLine, rowValue, sameSettings, withPreset } from './edits.ts';
import { A, AUTO, B, C, CUSTOM, D, resultOf, transition } from './test-helpers.ts';

const EDITED = { ...CUSTOM, effects: 'Echo ½ out end' } as const;

describe('withPreset', () => {
  it('nulls the rows for Auto and No transition, including bars', () => {
    expect(withPreset(CUSTOM, 'Auto', CUSTOM)).toEqual(AUTO);
    expect(withPreset(CUSTOM, 'No transition', CUSTOM)).toEqual({ ...AUTO, preset: 'No transition' });
  });

  it('keeps bars but nulls the rows for another named preset', () => {
    expect(withPreset(CUSTOM, 'Fade', CUSTOM)).toEqual({ ...AUTO, preset: 'Fade', bars: 8 });
    expect(withPreset(AUTO, 'Rise', AUTO, 4).bars).toBe(4);
  });

  it('fills Custom from the suggestion, or from plain starting values', () => {
    const suggested = { ...CUSTOM, bars: 2 as const, filter: 'High pass filter in' as const };
    expect(withPreset(AUTO, 'Custom', suggested)).toEqual(suggested);
    const fromAuto = withPreset(AUTO, 'Custom', AUTO, 4);
    expect(fromAuto).toMatchObject({ preset: 'Custom', bars: 4, volume: 'Smooth crossfade', looping: 'None' });
  });
});

describe('card text', () => {
  it('names the preset and shows "preset decides" for empty rows', () => {
    expect(presetLine('Auto')).toEqual({ before: 'Leave on ', name: 'Auto', after: ' — Spotify decides' });
    expect(presetLine('No transition')).toEqual({ before: 'Choose ', name: 'No transition', after: ' (hard cut)' });
    expect(rowValue(AUTO, 'eq')).toBe('— preset decides');
    expect(rowValue(CUSTOM, 'eq')).toBe('Center bass swap');
  });

  it('titles a pair with track numbers, bars and preset', () => {
    expect(pairTitle(2, CUSTOM)).toBe('3 → 4 · 8 bars · Custom');
    expect(pairTitle(0, AUTO)).toBe('1 → 2 · Auto');
  });

  it('detects edits', () => {
    expect(sameSettings(CUSTOM, { ...CUSTOM })).toBe(true);
    expect(isEdited(transition(CUSTOM))).toBe(false);
    expect(isEdited({ ...transition(CUSTOM), settings: EDITED })).toBe(true);
  });
});

describe('carryEdits', () => {
  it('keeps edits whose two tracks still follow each other and counts the rest', () => {
    const prev = resultOf([A, B, C, D]);
    prev.transitions[0] = { ...prev.transitions[0]!, settings: EDITED }; // A → B
    prev.transitions[2] = { ...prev.transitions[2]!, settings: AUTO }; // C → D
    const next = resultOf([D, A, B, C]); // A → B survives, C → D does not
    const { result, kept, dropped } = carryEdits(prev, next);
    expect(kept).toBe(1);
    expect(dropped).toBe(1);
    expect(result.transitions[1]!.settings).toEqual(EDITED);
    expect(result.transitions[1]!.suggested).toEqual(CUSTOM);
    expect(result.transitions[0]!.settings).toEqual(CUSTOM);
  });

  it('does nothing without a previous preview or without edits', () => {
    const next = resultOf([A, B]);
    expect(carryEdits(null, next).result).toBe(next);
    expect(carryEdits(resultOf([A, B]), next)).toEqual({ result: next, kept: 0, dropped: 0 });
  });
});

describe('patchRecord', () => {
  it('applies a tick and an edit and keeps the applied count', () => {
    const result = resultOf([A, B, C]);
    const record: DjSetRecord = {
      id: 's1',
      name: 'Test',
      createdAt: '2026-10-14T00:00:00Z',
      tracks: 3,
      durationMs: result.durationMs,
      score: 90,
      applied: 0,
      spotifyPlaylistId: null,
      spotifyUrl: null,
      config: {} as DjSetRecord['config'],
      result,
    };
    const ticked = patchRecord(record, 1, { applied: true });
    expect(ticked.applied).toBe(1);
    expect(ticked.result.transitions[1]!.applied).toBe(true);
    const edited = patchRecord(ticked, 0, { settings: AUTO });
    expect(edited.result.transitions[0]!.settings).toEqual(AUTO);
    expect(edited.result.transitions[1]!.applied).toBe(true);
    expect(record.applied).toBe(0);
  });
});
