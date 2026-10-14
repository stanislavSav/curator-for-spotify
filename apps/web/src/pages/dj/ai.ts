import type { AgentCli, AiPassResult, DjSetResult, DjSetTrack, DjTransition, TransitionSettings } from '@curator/shared';
import { aiDiffers, isEdited, pairKey, SETTING_KEYS, sameSettings } from './edits.ts';

// Pure helpers for the AI Pass and the track-data hints on the cards.

/** The name of the user's installed agent CLI. Naming the vendor is fine here: it is their tool. */
export const AGENT_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };

export const NO_AGENT_HELP =
  'No agent CLI found on this computer. Install the CLI of your AI agent (claude, codex or gemini), log in once, then reload this page.';

/** The pair keys ("fromId>toId") of a preview, kept when an AI pass starts. */
export const pairKeys = (r: DjSetResult) => r.transitions.map((_, i) => pairKey(r, i));

/**
 * Puts an AI pass result into a preview. Each pair gets `ai`; its settings
 * take the AI values unless the user edited that pair. With `keys` (the pair
 * keys when the pass started), results go to the same two tracks even if the
 * preview rebuilt meanwhile; pairs that are gone are skipped.
 */
export function mergeAiResult(result: DjSetResult, ai: AiPassResult, keys?: string[]): DjSetResult {
  const now = pairKeys(result);
  const transitions = [...result.transitions];
  for (const entry of ai.transitions) {
    const at = keys ? now.indexOf(keys[entry.index] ?? '') : entry.index;
    const t = transitions[at];
    if (at < 0 || !t) continue;
    const next: DjTransition = { ...t, ai: { settings: entry.settings, reason: entry.reason, agent: ai.agent } };
    if (!isEdited(t)) next.settings = entry.settings;
    transitions[at] = next;
  }
  return { ...result, transitions };
}

/** Pairs where the AI pass chose something other than the rules. */
export const aiChangedCount = (r: DjSetResult) => r.transitions.filter(aiDiffers).length;

/** "AI pass by Claude Code: Darker blends at the peak · 15 changed · 1 rejected". */
export function aiBannerText(agent: AgentCli, summary: string, changed: number, rejected: number): string {
  const parts = [`${changed} changed`, rejected > 0 ? `${rejected} rejected` : null].filter(Boolean);
  const head = `AI pass by ${AGENT_NAMES[agent]}`;
  return `${summary.trim() ? `${head}: ${summary.trim()}` : head} · ${parts.join(' · ')}`;
}

export const BARS_HINT = 'if Spotify offers bars';
export const BARS_HIDDEN_NOTE = 'Spotify may show no bar choice here (no clear beat) — skip it.';
export const BARS_16_NOTE = 'Spotify offers 16 bars only for some tracks — if it is not offered here, use 8.';

/** The note for a pair's bars (Spotify may hide them, or may not offer 16), or null. */
export const barsNote = (t: DjTransition): string | null =>
  t.settings.bars == null ? null : t.barsMayBeHidden ? BARS_HIDDEN_NOTE : t.settings.bars === 16 ? BARS_16_NOTE : null;

const VOCAL_MAX = 0.3;
const INSTRUMENTAL_MIN = 0.6;
const ACOUSTIC_MIN = 0.6;

const isVocal = (t: DjSetTrack) => t.instrumentalness != null && t.instrumentalness < VOCAL_MAX;
const isInstrumental = (t: DjSetTrack) => t.instrumentalness != null && t.instrumentalness >= INSTRUMENTAL_MIN;
const isAcoustic = (t: DjSetTrack) => t.acousticness != null && t.acousticness >= ACOUSTIC_MIN;

/** Small chips from the tracks' audio features, only when they matter for the blend. */
export function pairHints(from: DjSetTrack, to: DjSetTrack): { label: string; about: string }[] {
  const hints: { label: string; about: string }[] = [];
  if (isVocal(from) && isVocal(to)) {
    hints.push({ label: 'vocals ↔ vocals', about: 'Both tracks have vocals. Keep the overlap short so the voices do not clash.' });
  }
  if (isInstrumental(from)) hints.push({ label: 'instrumental out', about: 'The outgoing track is instrumental: a long blend or a loop works well.' });
  if (isInstrumental(to)) hints.push({ label: 'instrumental in', about: 'The incoming track is instrumental: it can come in early under the outgoing one.' });
  if (isAcoustic(from) || isAcoustic(to)) {
    hints.push({ label: 'acoustic', about: 'An acoustic track has a loose beat. Smooth crossfades work better than bass swaps.' });
  }
  return hints;
}

/** How many pairs of this AI pass differ from the rules, counted on the result it goes into. */
export function countAiChanges(result: DjSetResult, ai: AiPassResult, keys?: string[]): number {
  const now = pairKeys(result);
  return ai.transitions.filter((entry) => {
    const t = result.transitions[keys ? now.indexOf(keys[entry.index] ?? '') : entry.index];
    return t != null && !sameSettings(entry.settings, t.suggested);
  }).length;
}

/** "8 bars · Custom · Low pass filter in, Echo ½ out end": the bars, the preset and the rows that do something. */
export function settingsLine(s: TransitionSettings): string {
  const rows = SETTING_KEYS.map((k) => s[k]).filter((v) => v != null && v !== 'None');
  return [s.bars ? `${s.bars} bars` : null, s.preset, rows.join(', ') || null].filter(Boolean).join(' · ');
}
