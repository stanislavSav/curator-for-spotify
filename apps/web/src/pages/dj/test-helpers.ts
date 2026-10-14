import type { DjSetResult, DjSetTrack, DjTransition, TransitionSettings } from '@curator/shared';

// Fake ids and well-known public songs only.

export const track = (id: string, name: string, artist: string, bpm = 124, camelot: string | null = '8A'): DjSetTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [artist],
  durationMs: 200_000,
  bpm,
  camelot,
  energy: 0.6,
  valence: 0.5,
  danceability: 0.7,
  instrumentalness: null,
  acousticness: null,
  tags: [],
  targetEnergy: 0.6,
  locked: false,
});

export const CUSTOM: TransitionSettings = {
  preset: 'Custom',
  bars: 8,
  volume: 'Smooth crossfade',
  eq: 'Center bass swap',
  filter: 'None',
  effects: 'None',
  looping: 'None',
};

export const AUTO: TransitionSettings = { preset: 'Auto', bars: null, volume: null, eq: null, filter: null, effects: null, looping: null };

export const transition = (settings: TransitionSettings = CUSTOM, extra: Partial<DjTransition> = {}): DjTransition => ({
  settings,
  suggested: settings,
  bpmDeltaPct: 0.8,
  keyRelation: 'same',
  energyDelta: 0.1,
  reason: 'Same key and tempo.',
  barsMayBeHidden: false,
  ai: null,
  applied: false,
  ...extra,
});

export function resultOf(tracks: DjSetTrack[], transitions?: DjTransition[]): DjSetResult {
  return {
    seed: 1,
    tracks,
    transitions: transitions ?? tracks.slice(1).map(() => transition()),
    score: { total: 90, bpmSmooth: 1, keyCompatible: 1, energyFit: 0.9, artistRepeats: 0, cost: 1 },
    warnings: [],
    pool: { total: tracks.length, usable: tracks.length, noTempo: 0, outOfBpmRange: 0, noKey: 0, noEnergy: 0 },
    durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
  };
}

export const A = track('a', 'One More Time', 'Daft Punk', 123, '4A');
export const B = track('b', 'Around the World', 'Daft Punk', 121, '4B');
export const C = track('c', 'Music Sounds Better with You', 'Stardust', 124, null);
export const D = track('d', 'Lady (Hear Me Tonight)', 'Modjo', 126, '5A');
