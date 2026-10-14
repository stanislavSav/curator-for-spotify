import {
  BAR_OPTIONS,
  EFFECTS_OPTIONS,
  EQ_OPTIONS,
  FILTER_OPTIONS,
  LOOPING_OPTIONS,
  MIX_PRESETS,
  SHEET_STYLES,
  TRANSITION_COLOURS,
  VOLUME_OPTIONS,
  type DjSetConfig,
  type DjSetTrack,
  type DjTransition,
  type TransitionSettings,
} from '@curator/shared';
import { setPositions } from '../transitions.ts';

export interface AiPassInput {
  tracks: DjSetTrack[];
  transitions: DjTransition[];
  config: DjSetConfig;
  focus?: string;
}

export const MAX_REASON = 140;
export const MAX_SET_NAME = 60;

const num = (x: number | null) => (x == null ? '?' : x.toFixed(2));
const list = (xs: readonly (string | number)[]) => xs.map((x) => (typeof x === 'string' ? `"${x}"` : String(x))).join(', ');

function trackLine(t: DjSetTrack): string {
  return [
    `${t.name} — ${t.artists.join(', ')}`,
    `${t.bpm} BPM`,
    `key ${t.camelot ?? '?'}`,
    `energy ${num(t.energy)}`,
    `valence ${num(t.valence)}`,
    `danceability ${num(t.danceability)}`,
    `instrumentalness ${num(t.instrumentalness)}`,
    `acousticness ${num(t.acousticness)}`,
    `tags ${t.tags.length ? t.tags.join(', ') : '-'}`,
  ].join(' | ');
}

function settingsLine(s: TransitionSettings): string {
  if (s.preset !== 'Custom') return `preset ${s.preset}`;
  return `preset Custom, bars ${s.bars}, volume "${s.volume}", eq "${s.eq}", filter "${s.filter}", effects "${s.effects}", looping "${s.looping}"`;
}

/** The text sent to the agent on stdin. Pure: the same set always gives the same prompt. */
export function buildAiPassPrompt({ tracks, transitions, config, focus }: AiPassInput): string {
  const { sheetStyle, colour } = config.transitions;
  const positions = setPositions(tracks.map((t) => t.targetEnergy));
  const pairs = transitions.map((t, i) => {
    const a = tracks[i]!;
    const b = tracks[i + 1]!;
    const pos = positions[i];
    const where = pos ? `${Math.round(pos.p * 100)} % into the set, target energy ${b.targetEnergy.toFixed(2)}${pos.nearPeak ? ' (near the peak)' : ''}` : '';
    return [
      `Pair ${i}:`,
      `  out: ${trackLine(a)}`,
      `  in:  ${trackLine(b)}`,
      `  tempo ${t.bpmDeltaPct >= 0 ? '+' : ''}${t.bpmDeltaPct} %, key relation ${t.keyRelation}, ${where}`,
      `  current: ${settingsLine(t.settings)}${t.barsMayBeHidden ? ' (Spotify may hide the bar choice here)' : ''}`,
      `  rule reason: ${t.reason}`,
    ].join('\n');
  });

  return `You are an experienced DJ preparing Spotify Mix transitions for a DJ Set.
For each pair below, choose the transition to set in Spotify's "Edit transition" panel.

Rules:
- Use only these exact option names (copy them character for character):
  preset: ${list(MIX_PRESETS)}
  volume: ${list(VOLUME_OPTIONS)}
  eq: ${list(EQ_OPTIONS)}
  filter: ${list(FILTER_OPTIONS)}
  effects: ${list(EFFECTS_OPTIONS)}
  looping: ${list(LOOPING_OPTIONS)}
- "in" acts on the incoming (next) track, "out" on the outgoing (current) track.
- bars: ${BAR_OPTIONS.join(', ')} only. Spotify offers no more than 8.
- Use preset "Custom" with all five values set, unless "Auto" or "No transition" is clearly better; then set bars and the five values to null.
- Keep the current settings where they are already good. Change what a DJ would change.
- Sheet Style: ${SHEET_STYLES[sheetStyle].label} (${SHEET_STYLES[sheetStyle].about})
- Colour: ${TRANSITION_COLOURS[colour].label} (${TRANSITION_COLOURS[colour].about})
- The user's focus: ${focus?.trim() ? focus.trim() : 'none given'}
- Each reason: one short plain sentence, at most ${MAX_REASON} characters.
- Also suggest a name for the whole set: 2–6 words, evocative but clear about the mood, genre or moment (for example "Late Bloom Disco" or "Sunday Deep Drift"). No emoji, no quotes, no track or artist names, at most ${MAX_SET_NAME} characters.

Set: ${tracks.length} tracks, ${transitions.length} transitions. Values 0–1, "?" = unknown.

${pairs.join('\n\n')}

Answer with STRICT JSON only, no prose and no code fences, in this shape:
{"name": "a name for the set", "summary": "one or two sentences about the set as a whole", "transitions": [{"index": 0, "preset": "Custom", "bars": 8, "volume": "...", "eq": "...", "filter": "...", "effects": "...", "looping": "...", "reason": "..."}]}
Give one entry per pair, index 0 to ${transitions.length - 1}.
`;
}
