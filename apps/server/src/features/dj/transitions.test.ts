import { describe, expect, it } from 'vitest';
import { DEFAULT_DJ_CONFIG, toCamelot, type DjSetConfig } from '@curator/shared';
import { bpmCost, keyCost, keyRelation, parseCamelot, signedTempoDelta } from './harmony.ts';
import { suggestTransition, type TransitionEnd } from './transitions.ts';

const cam = (s: string) => parseCamelot(s);
const end = (bpm: number, camelot: string | null, energy: number | null = 0.6): TransitionEnd => ({
  name: 'x',
  bpm,
  camelot: camelot ? cam(camelot) : null,
  energy,
});
const prefs = (over: Partial<DjSetConfig['transitions']> = {}): DjSetConfig => ({
  ...structuredClone(DEFAULT_DJ_CONFIG),
  transitions: { ...structuredClone(DEFAULT_DJ_CONFIG.transitions), ...over },
});

describe('harmony helpers', () => {
  it('signedTempoDelta is signed and half/double aware', () => {
    expect(signedTempoDelta(120, 126)).toBeCloseTo(0.05);
    expect(signedTempoDelta(126, 120)).toBeCloseTo(-0.0476, 3);
    expect(signedTempoDelta(170, 86)).toBeCloseTo(2 / 170);
    expect(signedTempoDelta(170, 86, false)).toBeCloseTo(-84 / 170);
  });

  it('bpmCost is 1.0 at exactly the max step and 0 for half time', () => {
    expect(bpmCost(100, 106, 6)).toBeCloseTo(1);
    expect(bpmCost(106, 100, 6)).toBeCloseTo(1);
    expect(bpmCost(85, 170, 6)).toBeCloseTo(0);
    expect(bpmCost(85, 170, 6, false)).toBeGreaterThan(10);
  });

  it('keyCost follows research 04 §6.2', () => {
    expect(keyCost(cam('8A')!, cam('8A')!)).toBe(0);
    expect(keyCost(cam('8A')!, cam('9A')!)).toBe(1);
    expect(keyCost(cam('8A')!, cam('8B')!)).toBe(1);
    expect(keyCost(cam('8A')!, cam('9B')!)).toBe(2.5);
    expect(keyCost(cam('1A')!, cam('7B')!)).toBe(4);
  });

  it('keyRelation names the move', () => {
    expect(keyRelation(cam('8A'), cam('8A'))).toBe('same');
    expect(keyRelation(cam('8A'), cam('9A'))).toBe('adjacent');
    expect(keyRelation(cam('12A'), cam('1A'))).toBe('adjacent');
    expect(keyRelation(cam('8A'), cam('8B'))).toBe('relative');
    expect(keyRelation(cam('8A'), cam('10A'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('3A'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('9B'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('2A'))).toBe('clash');
    expect(keyRelation(cam('8A'), cam('5B'))).toBe('clash');
    expect(keyRelation(null, cam('5B'))).toBe('unknown');
  });

  it('parseCamelot round-trips shared toCamelot', () => {
    expect(parseCamelot('8A')).toEqual(toCamelot(9, 0));
    expect(parseCamelot('13A')).toBeNull();
    expect(parseCamelot('x')).toBeNull();
  });
});

describe('suggestTransition', () => {
  it('compatible key and tempo within 3 % → long Blend with a low swap', () => {
    const t = suggestTransition(end(124, '8A'), end(126, '9A'), prefs());
    expect(t).toMatchObject({ style: 'Blend', bars: 8, keyRelation: 'adjacent', cutHint: false });
    expect(t.eqHint).toMatch(/lows/i);
    expect(t.bpmDeltaPct).toBeCloseTo(1.6, 1);
    expect(t.reason).toMatch(/neighbour keys \(8A → 9A\)/i);
  });

  it('same key and almost same tempo → 16 bars', () => {
    expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs())).toMatchObject({ style: 'Blend', bars: 16 });
  });

  it('uses Fade when Blend is switched off', () => {
    const t = suggestTransition(end(124, '8A'), end(125, '8B'), prefs({ styles: { Fade: true, Rise: true, Blend: false } }));
    expect(t.style).toBe('Fade');
  });

  it('a sharp energy rise → Rise, 8 bars', () => {
    const t = suggestTransition(end(124, '8A', 0.5), end(126, '9A', 0.8), prefs());
    expect(t).toMatchObject({ style: 'Rise', bars: 8, energyDelta: 0.3 });
    expect(t.reason).toMatch(/Energy rises/);
  });

  it('a key clash → short 4-bar Fade', () => {
    const t = suggestTransition(end(124, '8A'), end(125, '2A'), prefs());
    expect(t).toMatchObject({ style: 'Fade', bars: 4, keyRelation: 'clash', cutHint: false });
    expect(t.reason).toMatch(/Keys clash/);
  });

  it('a big tempo jump → 2-bar Fade with a cut hint', () => {
    const t = suggestTransition(end(100, '8A'), end(118, '8A'), prefs());
    expect(t).toMatchObject({ style: 'Fade', bars: 2, cutHint: true });
    expect(t.reason).toMatch(/consider a cut/i);
  });

  it('unknown key → Auto with no bars', () => {
    const t = suggestTransition(end(124, null), end(125, '8A'), prefs());
    expect(t).toMatchObject({ style: 'Auto', bars: null, keyRelation: 'unknown', eqHint: null });
  });

  it('a big tempo jump wins over an unknown key', () => {
    expect(suggestTransition(end(100, null), end(110, '8A'), prefs())).toMatchObject({ style: 'Fade', bars: 4 });
  });

  it('respects rule toggles', () => {
    const off = { longBlendWhenCompatible: false, riseOnEnergyJump: false, shortFadeOnClash: false, autoWhenUnknown: false };
    expect(suggestTransition(end(124, '8A', 0.4), end(126, '8A', 0.8), prefs({ rules: off })).style).toBe('Fade');
    expect(suggestTransition(end(124, '8A'), end(125, '2A'), prefs({ rules: off })).style).toBe('Auto');
  });

  it('falls back to Auto when Fade is off on a clash', () => {
    const t = suggestTransition(end(124, '8A'), end(125, '2A'), prefs({ styles: { Fade: false, Rise: true, Blend: true } }));
    expect(t).toMatchObject({ style: 'Auto', bars: null });
  });

  it('energy-boost key move → Rise', () => {
    expect(suggestTransition(end(124, '8A'), end(127, '10A'), prefs()).style).toBe('Rise');
  });

  it('half-time pair counts as a small tempo change', () => {
    const t = suggestTransition(end(170, '8A'), end(86, '8A'), prefs());
    expect(t.bpmDeltaPct).toBeCloseTo(1.2, 1);
    expect(t.style).toBe('Blend');
  });
});
