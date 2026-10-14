// Test-only: a tiny DJ Set with well-known public songs and fake ids.
import { DEFAULT_DJ_CONFIG, type DjSetConfig, type DjSetTrack, type DjTransition } from '@curator/shared';
import { parseCamelot } from '../harmony.ts';
import { setPositions, suggestTransition } from '../transitions.ts';

const track = (id: string, name: string, artist: string, bpm: number, camelot: string, energy: number, over: Partial<DjSetTrack> = {}): DjSetTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [artist],
  durationMs: 240_000,
  bpm,
  camelot,
  energy,
  valence: 0.6,
  danceability: 0.75,
  instrumentalness: 0.1,
  acousticness: 0.05,
  tags: ['house'],
  targetEnergy: energy,
  locked: false,
  ...over,
});

export function sampleSet(config: DjSetConfig = structuredClone(DEFAULT_DJ_CONFIG)): { tracks: DjSetTrack[]; transitions: DjTransition[]; config: DjSetConfig } {
  const tracks = [
    track('fx1', 'One More Time', 'Daft Punk', 123, '8A', 0.6),
    track('fx2', 'Strings of Life', 'Rhythim Is Rhythim', 125, '9A', 0.7, { instrumentalness: 0.9, tags: ['techno', 'detroit techno'] }),
    track('fx3', 'Music Sounds Better with You', 'Stardust', 124, '9A', 0.85),
    track('fx4', 'Teardrop', 'Massive Attack', 77, '10A', 0.4, { danceability: 0.3, acousticness: 0.4, tags: ['trip-hop'] }),
  ];
  const positions = setPositions(tracks.map((t) => t.targetEnergy));
  const end = (t: DjSetTrack) => ({ ...t, camelot: parseCamelot(t.camelot) });
  const transitions = tracks.slice(1).map((b, i) => suggestTransition(end(tracks[i]!), end(b), config, positions[i]));
  return { tracks, transitions, config };
}
