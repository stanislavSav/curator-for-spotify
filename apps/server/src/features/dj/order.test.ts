import { describe, expect, it } from 'vitest';
import { curveTarget } from '@curator/shared';
import { seededRng } from './rng.ts';
import { buildDjSet, wantedCount, type DjCandidate } from './order.ts';
import { cand, config } from './test-helpers.ts';

/** A varied pool: tempos 100–140, all keys, energies 0.2–1. */
function randomPool(size: number, seed = 1): DjCandidate[] {
  const rng = seededRng(seed);
  return Array.from({ length: size }, (_, i) =>
    cand(
      `t${String(i).padStart(4, '0')}`,
      100 + Math.round(rng() * 40),
      [Math.floor(rng() * 12), rng() < 0.5 ? 0 : 1],
      Math.round((0.2 + rng() * 0.8) * 100) / 100,
      `ar${i % Math.max(1, Math.floor(size / 3))}`,
    ),
  );
}

const ids = (r: { tracks: { id: string }[] }) => r.tracks.map((t) => t.id);

function correlation(xs: number[], ys: number[]) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    dx += (x - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  });
  return num / Math.sqrt(dx * dy);
}

describe('curveTarget', () => {
  it('interpolates the preset points', () => {
    expect(curveTarget({ preset: 'build' }, 0)).toBeCloseTo(0.4);
    expect(curveTarget({ preset: 'build' }, 0.5)).toBeCloseTo(0.65);
    expect(curveTarget({ preset: 'build' }, 1)).toBeCloseTo(0.9);
    expect(curveTarget({ preset: 'custom', points: [0.2, 0.8, 0.2] }, 0.5)).toBeCloseTo(0.8);
    expect(curveTarget({ preset: 'custom', points: [0.2, 0.8, 0.2] }, 0.25)).toBeCloseTo(0.5);
  });
});

describe('wantedCount', () => {
  it('uses the track count or the average duration', () => {
    const pool = randomPool(10);
    expect(wantedCount(config({ length: { mode: 'tracks', count: 7 } }), pool)).toBe(7);
    expect(wantedCount(config({ length: { mode: 'minutes', minutes: 60 } }), pool)).toBe(18); // 3:20 per track
  });
});

describe('buildDjSet', () => {
  const cfg = config({ length: { mode: 'tracks', count: 20 } });

  it('returns the asked number of tracks and one transition per pair', () => {
    const r = buildDjSet(randomPool(120), cfg, 7);
    expect(r.tracks).toHaveLength(20);
    expect(r.transitions).toHaveLength(19);
    expect(new Set(ids(r)).size).toBe(20);
    expect(r.durationMs).toBe(20 * 200_000);
    expect(r.seed).toBe(7);
  });

  it('is deterministic for a seed and varies with the seed', () => {
    const pool = randomPool(150);
    expect(ids(buildDjSet(pool, cfg, 42))).toEqual(ids(buildDjSet(pool, cfg, 42)));
    expect(ids(buildDjSet(pool, cfg, 42))).not.toEqual(ids(buildDjSet(pool, cfg, 43)));
  });

  it('follows the Energy Curve', () => {
    const r = buildDjSet(randomPool(200), config({ length: { mode: 'tracks', count: 20 }, curve: { preset: 'build' } }), 3);
    const energies = r.tracks.map((t) => t.energy!);
    expect(correlation(energies, r.tracks.map((_, i) => i))).toBeGreaterThan(0.8);
    expect(r.score.energyFit).toBeGreaterThan(0.85);
    expect(r.tracks[0]!.targetEnergy).toBeCloseTo(0.4);
    expect(r.tracks.at(-1)!.targetEnergy).toBeCloseTo(0.9);
  });

  it('keeps tempo steps and keys smooth on a rich pool', () => {
    const r = buildDjSet(randomPool(300), cfg, 5);
    expect(r.score.bpmSmooth).toBe(1);
    expect(r.score.keyCompatible).toBeGreaterThanOrEqual(0.9);
    expect(r.score.total).toBeGreaterThan(80);
  });

  it('fits the curve better when the key rule is off', () => {
    const pool = randomPool(200);
    const build = config({ length: { mode: 'tracks', count: 20 }, curve: { preset: 'build' } });
    const keyed = buildDjSet(pool, build, 3);
    const free = buildDjSet(pool, { ...build, keyStrictness: 'off' }, 3);
    expect(free.score.energyFit).toBeGreaterThan(keyed.score.energyFit);
    expect(keyed.score.keyCompatible).toBeGreaterThan(free.score.keyCompatible);
  });

  it('starts with the start track', () => {
    const pool = randomPool(80);
    const r = buildDjSet(pool, { ...cfg, startTrackId: 't0050' }, 1);
    expect(r.tracks[0]!.id).toBe('t0050');
  });

  it('always includes locked tracks, even ones that fit badly', () => {
    const pool = [...randomPool(80), cand('odd', 175, [1, 1], 0.05)];
    const r = buildDjSet(pool, { ...cfg, lockedTrackIds: ['odd', 't0010'] }, 1);
    expect(ids(r)).toContain('odd');
    expect(ids(r)).toContain('t0010');
    expect(r.tracks.find((t) => t.id === 'odd')!.locked).toBe(true);
    expect(r.tracks).toHaveLength(20);
  });

  it('respects artist spacing when the pool allows it', () => {
    // 4 artists, 40 tracks, all else equal.
    const pool = Array.from({ length: 40 }, (_, i) => cand(`a${i}`, 120, [8, 0], 0.7, `artist${i % 4}`));
    const r = buildDjSet(pool, { ...cfg, artistSpacing: 3, curve: { preset: 'steady' } }, 2);
    expect(r.score.artistRepeats).toBe(0);
  });

  it('treats half/double time as compatible when allowed', () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => cand(`h${i}`, 85, [8, 0], 0.7)),
      ...Array.from({ length: 6 }, (_, i) => cand(`d${i}`, 170, [8, 0], 0.7)),
    ];
    const r = buildDjSet(pool, { ...cfg, length: { mode: 'tracks', count: 12 }, curve: { preset: 'steady' } }, 1);
    expect(r.score.bpmSmooth).toBe(1);
    const strict = buildDjSet(pool, { ...cfg, allowHalfDouble: false, length: { mode: 'tracks', count: 12 } }, 1);
    expect(strict.score.bpmSmooth).toBeLessThan(1);
    // Without half/double, the two tempo groups stay together: only one jump.
    expect(strict.transitions.filter((t) => Math.abs(t.bpmDeltaPct) > 6)).toHaveLength(1);
  });

  it('shortens the set and warns when the pool is small', () => {
    const r = buildDjSet(randomPool(5), cfg, 1);
    expect(r.tracks).toHaveLength(5);
    expect(r.warnings.join(' ')).toMatch(/only 5 usable tracks/);
  });

  it('handles an empty pool', () => {
    const r = buildDjSet([], cfg, 1);
    expect(r.tracks).toEqual([]);
    expect(r.transitions).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/no usable tracks/);
  });

  it('warns about tracks without key or energy', () => {
    const pool = [cand('a', 120, null, 0.6), cand('b', 121, [8, 0], null), cand('c', 122, [8, 0], 0.6)];
    const r = buildDjSet(pool, { ...cfg, length: { mode: 'tracks', count: 3 } }, 1);
    expect(r.warnings.join(' ')).toMatch(/1 track in the set has no key, so its transitions/);
    expect(r.warnings.join(' ')).toMatch(/no energy value/);
  });

  it('runs fast on a big pool', () => {
    const t0 = performance.now();
    const r = buildDjSet(randomPool(3000), config({ length: { mode: 'tracks', count: 40 } }), 9);
    expect(r.tracks).toHaveLength(40);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
