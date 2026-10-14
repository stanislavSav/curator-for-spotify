import {
  camelotDistance,
  camelotLabel,
  curveTarget,
  KEY_LIMIT,
  tempoDelta,
  type Camelot,
  type DjPoolStats,
  type DjScore,
  type DjSetConfig,
  type DjSetResult,
} from '@curator/shared';
import { bpmCost, keyCost } from './harmony.ts';
import { seededRng } from './rng.ts';
import { setPositions, suggestTransition } from './transitions.ts';

/** A Pool track that can be ordered: BPM is known. */
export interface DjCandidate {
  id: string;
  uri: string;
  name: string;
  artistIds: string[];
  artistNames: string[];
  durationMs: number;
  bpm: number;
  camelot: Camelot | null;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  instrumentalness: number | null;
  acousticness: number | null;
  /** Top tags, highest weight first. */
  tags: string[];
}

/**
 * Cost weights (research 04 §6.4). Energy terms are scaled ×4 so that being
 * 0.25 off weighs as much as one full tempo step or one Camelot step.
 */
export const WEIGHTS = {
  bpm: 1,
  key: 1,
  energyStep: 0.5,
  target: 1,
  /** Flat cost when one key is unknown, so known keys are preferred. */
  unknownKey: 0.6,
  /** Flat cost for unknown energy; the track counts as 0.5. */
  unknownEnergy: 0.3,
  /** Added once a pair breaks the tempo step or the key limit. */
  overLimit: 3,
  artist: 5,
  /** Per-seed preference noise; makes Regenerate pick other tracks. */
  seedNoise: 0.35,
  /** Pull locked tracks into the set. */
  lockBonus: 2,
} as const;

/** Upper bound on cost evaluations in the local search. Deterministic, unlike a time cap. */
export const SEARCH_BUDGET = 3_000_000;

const ENERGY_SCALE = 4;
const EPS = 1e-9;

interface Ctx {
  cfg: DjSetConfig;
  targets: number[];
  keyLimit: number;
  bias: Map<string, number>;
  evals: number;
}

/** Cost of placing path[k] at position k: its own target fit plus the transition into it. */
function stepCost(ctx: Ctx, path: DjCandidate[], k: number): number {
  ctx.evals++;
  const cur = path[k]!;
  const { cfg } = ctx;
  let cost = ctx.bias.get(cur.id) ?? 0;
  const e = cur.energy ?? 0.5;
  cost += WEIGHTS.target * ENERGY_SCALE * Math.abs(e - ctx.targets[k]!);
  if (cur.energy == null) cost += WEIGHTS.unknownEnergy;
  if (k === 0) return cost;

  const prev = path[k - 1]!;
  const b = bpmCost(prev.bpm, cur.bpm, cfg.maxBpmStepPct, cfg.allowHalfDouble);
  cost += WEIGHTS.bpm * b;
  if (b > 1 + EPS) cost += WEIGHTS.overLimit + (b - 1) * 2;

  if (cfg.keyStrictness !== 'off') {
    if (prev.camelot && cur.camelot) {
      cost += WEIGHTS.key * keyCost(prev.camelot, cur.camelot);
      if (camelotDistance(prev.camelot, cur.camelot) > ctx.keyLimit) cost += WEIGHTS.overLimit;
    } else cost += WEIGHTS.unknownKey;
  }

  cost += WEIGHTS.energyStep * ENERGY_SCALE * Math.abs(e - (prev.energy ?? 0.5));
  if (artistRepeat(path, k, cfg.artistSpacing)) cost += WEIGHTS.artist;
  return cost;
}

function artistRepeat(path: DjCandidate[], k: number, spacing: number): boolean {
  const cur = path[k]!;
  for (let j = Math.max(0, k - spacing); j < k; j++) {
    if (path[j]!.artistIds.some((a) => cur.artistIds.includes(a))) return true;
  }
  return false;
}

const rangeCost = (ctx: Ctx, path: DjCandidate[], from: number, to: number) => {
  let sum = 0;
  for (let k = Math.max(0, from); k <= Math.min(path.length - 1, to); k++) sum += stepCost(ctx, path, k);
  return sum;
};

const pathCost = (ctx: Ctx, path: DjCandidate[]) => rangeCost(ctx, path, 0, path.length - 1);

/** How many tracks the set should have, before the Pool size limit. */
export function wantedCount(cfg: DjSetConfig, pool: DjCandidate[]): number {
  if (cfg.length.mode === 'tracks') return Math.max(1, Math.round(cfg.length.count));
  const avg = pool.length ? pool.reduce((s, t) => s + t.durationMs, 0) / pool.length : 210_000;
  return Math.max(2, Math.round((cfg.length.minutes * 60_000) / avg));
}

const emptyStats = (n: number): DjPoolStats => ({ total: n, usable: n, noTempo: 0, outOfBpmRange: 0, noKey: 0, noEnergy: 0 });

/**
 * Builds a DJ Set from usable Pool tracks: greedy nearest neighbour from the
 * start track, then 2-opt and swap-in improvement under a fixed budget.
 * Deterministic for a given seed.
 */
export function buildDjSet(
  pool: DjCandidate[],
  cfg: DjSetConfig,
  seed: number,
  poolStats: DjPoolStats = emptyStats(pool.length),
  poolWarnings: string[] = [],
): DjSetResult {
  const rng = seededRng(seed);
  const warnings = [...poolWarnings];
  const byId = new Map(pool.map((t) => [t.id, t]));
  const locked = [...new Set(cfg.lockedTrackIds)].map((id) => byId.get(id)).filter((t): t is DjCandidate => !!t);
  const start = cfg.startTrackId ? (byId.get(cfg.startTrackId) ?? null) : null;

  const asked = wantedCount(cfg, pool);
  const minimum = locked.length + (start && !locked.includes(start) ? 1 : 0);
  let n = Math.min(asked, pool.length);
  if (n < minimum) n = minimum;
  if (pool.length === 0) {
    warnings.push('The Pool has no usable tracks. Pick other playlists, widen the filters, or run Enrich to get BPM data.');
  } else if (n < asked) {
    warnings.push(`The Pool has only ${pool.length} usable tracks, so the set is shorter than asked (${n} of ${asked}).`);
  }

  const targets = Array.from({ length: n }, (_, k) => curveTarget(cfg.curve, n === 1 ? 0 : k / (n - 1)));
  const bias = new Map<string, number>();
  for (const t of pool) bias.set(t.id, rng() * WEIGHTS.seedNoise);
  for (const t of locked) bias.set(t.id, -WEIGHTS.lockBonus);
  const ctx: Ctx = { cfg, targets, keyLimit: KEY_LIMIT[cfg.keyStrictness], bias, evals: 0 };

  const path = n > 0 ? greedy(ctx, pool, n, start, rng) : [];
  const lockedIds = new Set(locked.map((t) => t.id));
  const fixedFirst = start != null;
  forceLocked(ctx, path, locked, lockedIds, fixedFirst);
  improve(ctx, path, pool, lockedIds, fixedFirst);

  // Report cost without the per-seed noise and lock bonus.
  const plain: Ctx = { ...ctx, bias: new Map() };
  return describe(plain, path, cfg, seed, lockedIds, poolStats, warnings);
}

function greedy(ctx: Ctx, pool: DjCandidate[], n: number, start: DjCandidate | null, rng: () => number): DjCandidate[] {
  const path: DjCandidate[] = [];
  const used = new Set<string>();
  if (start) {
    path.push(start);
    used.add(start.id);
  } else {
    // A random pick among the three best openers keeps Regenerate varied.
    const ranked = pool
      .map((t) => ({ t, c: stepCost(ctx, [t], 0) }))
      .sort((a, b) => a.c - b.c || a.t.id.localeCompare(b.t.id))
      .slice(0, 3);
    const first = ranked[Math.floor(rng() * ranked.length)]!.t;
    path.push(first);
    used.add(first.id);
  }
  while (path.length < n) {
    let best: DjCandidate | null = null;
    let bestCost = Infinity;
    for (const t of pool) {
      if (used.has(t.id)) continue;
      path.push(t);
      const c = stepCost(ctx, path, path.length - 1);
      path.pop();
      if (c < bestCost) {
        bestCost = c;
        best = t;
      }
    }
    if (!best) break;
    path.push(best);
    used.add(best.id);
  }
  return path;
}

/** Puts every locked track into the set, replacing the position where it costs least. */
function forceLocked(
  ctx: Ctx,
  path: DjCandidate[],
  locked: DjCandidate[],
  lockedIds: Set<string>,
  fixedFirst: boolean,
) {
  const window = Math.max(1, ctx.cfg.artistSpacing);
  for (const t of locked) {
    if (path.includes(t)) continue;
    let bestK = -1;
    let bestDelta = Infinity;
    for (let k = fixedFirst ? 1 : 0; k < path.length; k++) {
      if (lockedIds.has(path[k]!.id)) continue;
      const before = rangeCost(ctx, path, k, k + window);
      const old = path[k]!;
      path[k] = t;
      const delta = rangeCost(ctx, path, k, k + window) - before;
      path[k] = old;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestK = k;
      }
    }
    if (bestK >= 0) path[bestK] = t;
  }
}

function improve(ctx: Ctx, path: DjCandidate[], pool: DjCandidate[], lockedIds: Set<string>, fixedFirst: boolean) {
  const n = path.length;
  if (n < 2) return;
  const window = Math.max(1, ctx.cfg.artistSpacing);
  const lo = fixedFirst ? 1 : 0;
  let improved = true;
  while (improved && ctx.evals < SEARCH_BUDGET) {
    improved = false;

    // 2-opt: reverse a segment when that lowers the cost.
    for (let i = lo; i < n - 1 && ctx.evals < SEARCH_BUDGET; i++) {
      for (let j = i + 1; j < n && ctx.evals < SEARCH_BUDGET; j++) {
        const before = rangeCost(ctx, path, i, j + window);
        reverse(path, i, j);
        if (rangeCost(ctx, path, i, j + window) < before - EPS) improved = true;
        else reverse(path, i, j);
      }
    }

    // Swap-in: replace a track with an unused Pool track when that lowers the cost.
    const inSet = new Set(path.map((t) => t.id));
    for (let k = lo; k < n && ctx.evals < SEARCH_BUDGET; k++) {
      if (lockedIds.has(path[k]!.id)) continue;
      const before = rangeCost(ctx, path, k, k + window);
      const old = path[k]!;
      let best: DjCandidate | null = null;
      let bestCost = before - EPS;
      for (const t of pool) {
        if (inSet.has(t.id)) continue;
        path[k] = t;
        const c = rangeCost(ctx, path, k, k + window);
        if (c < bestCost) {
          bestCost = c;
          best = t;
        }
      }
      path[k] = best ?? old;
      if (best) {
        inSet.delete(old.id);
        inSet.add(best.id);
        improved = true;
      }
    }
  }
}

function reverse<T>(a: T[], i: number, j: number) {
  while (i < j) {
    [a[i], a[j]] = [a[j]!, a[i]!];
    i++;
    j--;
  }
}

function describe(
  ctx: Ctx,
  path: DjCandidate[],
  cfg: DjSetConfig,
  seed: number,
  lockedIds: Set<string>,
  poolStats: DjPoolStats,
  warnings: string[],
): DjSetResult {
  const tracks = path.map((t, k) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artistNames,
    durationMs: t.durationMs,
    bpm: Math.round(t.bpm * 10) / 10,
    camelot: t.camelot ? camelotLabel(t.camelot) : null,
    energy: round2(t.energy),
    valence: round2(t.valence),
    danceability: round2(t.danceability),
    instrumentalness: round2(t.instrumentalness),
    acousticness: round2(t.acousticness),
    tags: t.tags.slice(0, 6),
    targetEnergy: Math.round(ctx.targets[k]! * 100) / 100,
    locked: lockedIds.has(t.id),
  }));
  const positions = setPositions(ctx.targets.slice(0, path.length));
  const transitions = path.slice(1).map((b, i) => suggestTransition(path[i]!, b, cfg, positions[i]));
  const score = scoreSet(ctx, path, cfg);

  const overStep = transitions.filter((t) => Math.abs(t.bpmDeltaPct) > cfg.maxBpmStepPct).length;
  if (overStep) warnings.push(`${overStep} transition${s(overStep)} ${verb(overStep, 'changes', 'change')} tempo by more than ${cfg.maxBpmStepPct} %.`);
  const clashes = transitions.filter((t) => t.keyRelation === 'clash').length;
  if (clashes && cfg.keyStrictness !== 'off') warnings.push(`${clashes} transition${s(clashes)} ${verb(clashes, 'has', 'have')} clashing keys.`);
  const noKey = path.filter((t) => !t.camelot).length;
  if (noKey) warnings.push(`${noKey} track${s(noKey)} in the set ${verb(noKey, 'has', 'have')} no key, so ${noKey === 1 ? 'its' : 'their'} transitions are left on Auto.`);
  const noEnergy = path.filter((t) => t.energy == null).length;
  if (noEnergy) warnings.push(`${noEnergy} track${s(noEnergy)} in the set ${verb(noEnergy, 'has', 'have')} no energy value; ${noEnergy === 1 ? 'it counts' : 'they count'} as 0.50.`);
  if (path.length > 1 && score.energyFit < 0.85) {
    const bias = path.reduce((sum, t, k) => sum + ((t.energy ?? 0.5) - ctx.targets[k]!), 0) / path.length;
    warnings.push(
      `The set follows the Energy Curve loosely: the Pool has few ${bias < 0 ? 'high' : 'low'}-energy tracks. Widen the Pool or pick another curve.`,
    );
  }
  if (score.artistRepeats) warnings.push(`${score.artistRepeats} artist repeat${s(score.artistRepeats)} within ${cfg.artistSpacing} tracks: the Pool is too small for this spacing.`);

  return {
    seed,
    tracks,
    transitions,
    score,
    warnings,
    pool: poolStats,
    durationMs: path.reduce((sum, t) => sum + t.durationMs, 0),
  };
}

const s = (n: number) => (n === 1 ? '' : 's');
const round2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
const verb = (n: number, one: string, many: string) => (n === 1 ? one : many);

function scoreSet(ctx: Ctx, path: DjCandidate[], cfg: DjSetConfig): DjScore {
  const pairs = path.length - 1;
  let bpmOk = 0;
  let keyPairs = 0;
  let keyOk = 0;
  let artistRepeats = 0;
  const keyLimit = Number.isFinite(ctx.keyLimit) ? ctx.keyLimit : 2;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    if (tempoDelta(a.bpm, b.bpm, cfg.allowHalfDouble) * 100 <= cfg.maxBpmStepPct + EPS) bpmOk++;
    if (a.camelot && b.camelot) {
      keyPairs++;
      if (camelotDistance(a.camelot, b.camelot) <= keyLimit) keyOk++;
    }
    if (artistRepeat(path, k, cfg.artistSpacing)) artistRepeats++;
  }
  const withEnergy = path.map((t, k) => [t.energy, ctx.targets[k]!] as const).filter(([e]) => e != null);
  const energyFit = withEnergy.length
    ? 1 - withEnergy.reduce((sum, [e, t]) => sum + Math.abs(e! - t), 0) / withEnergy.length
    : 0;
  const bpmSmooth = pairs > 0 ? bpmOk / pairs : 1;
  const keyCompatible = keyPairs > 0 ? keyOk / keyPairs : 1;
  const total = Math.round(
    Math.max(0, Math.min(100, 100 * (0.35 * bpmSmooth + 0.3 * keyCompatible + 0.35 * energyFit) - 5 * artistRepeats)),
  );
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    total,
    bpmSmooth: round(bpmSmooth),
    keyCompatible: round(keyCompatible),
    energyFit: round(energyFit),
    artistRepeats,
    cost: Math.round(pathCost(ctx, path) * 100) / 100,
  };
}
