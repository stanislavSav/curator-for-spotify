import type { Camelot, DjSetConfig, DjTransition, TransitionBars, TransitionStyle } from '@curator/shared';
import { describeKeyMove, isCompatible, keyRelation, signedTempoDelta } from './harmony.ts';

export interface TransitionEnd {
  name: string;
  bpm: number;
  camelot: Camelot | null;
  energy: number | null;
}

type Prefs = Pick<DjSetConfig, 'maxBpmStepPct' | 'allowHalfDouble' | 'transitions'>;

const pct = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} %`;
const e2 = (e: number) => e.toFixed(2);

/**
 * Suggests one Spotify Mix Transition for the pair a → b. The rules run in a
 * fixed order and the first that fires wins. ADR 0002: this is advice only.
 */
export function suggestTransition(a: TransitionEnd, b: TransitionEnd, prefs: Prefs): DjTransition {
  const { rules, styles, defaultBars } = prefs.transitions;
  const delta = signedTempoDelta(a.bpm, b.bpm, prefs.allowHalfDouble) * 100;
  const absDelta = Math.abs(delta);
  const rel = keyRelation(a.camelot, b.camelot);
  const energyDelta = a.energy != null && b.energy != null ? Math.round((b.energy - a.energy) * 100) / 100 : null;
  const step = prefs.maxBpmStepPct;
  const keyText = describeKeyMove(rel, a.camelot, b.camelot);
  const tempoText = `tempo ${pct(delta)}`;

  const allowed = (s: TransitionStyle) => s === 'Auto' || styles[s as Exclude<TransitionStyle, 'Auto'>];
  const pick = (want: TransitionStyle): TransitionStyle => (allowed(want) ? want : allowed('Fade') ? 'Fade' : 'Auto');

  const make = (
    style: TransitionStyle,
    bars: TransitionBars | null,
    reason: string,
    eqHint: string | null = null,
    cutHint = false,
  ): DjTransition => ({
    style,
    bars: style === 'Auto' ? null : bars,
    bpmDeltaPct: Math.round(delta * 10) / 10,
    keyRelation: rel,
    energyDelta,
    eqHint: style === 'Auto' ? null : eqHint,
    cutHint,
    reason,
  });

  if (rules.shortFadeOnClash && (rel === 'clash' || absDelta > step)) {
    const big = absDelta > step * 2 || (rel === 'clash' && absDelta > step);
    const problems = [rel === 'clash' ? keyText : null, absDelta > step ? `tempo jumps ${pct(delta)}` : null]
      .filter(Boolean)
      .join(' and ');
    const style = pick('Fade');
    const advice = big ? 'Consider a cut: a quick 2-bar Fade.' : 'Keep it short: a 4-bar Fade.';
    return make(
      style,
      big ? 2 : 4,
      `${capital(problems)}. ${style === 'Auto' ? 'Fade is off, so leave Auto.' : advice}`,
      'Cut the lows of the outgoing track early.',
      big,
    );
  }

  if (rules.autoWhenUnknown && rel === 'unknown') {
    const which = !a.camelot && !b.camelot ? 'both tracks' : !a.camelot ? `“${a.name}”` : `“${b.name}”`;
    return make('Auto', null, `Key unknown for ${which}. Leave it on Auto: Spotify sees the beat grid.`);
  }

  if (rules.riseOnEnergyJump && energyDelta != null && energyDelta >= 0.15 && allowed('Rise')) {
    return make(
      'Rise',
      8,
      `Energy rises sharply (${e2(a.energy!)} → ${e2(b.energy!)}), ${tempoText}. Rise builds into the next track.`,
      'High-pass the outgoing track; let the lows of the incoming track in at the end.',
    );
  }

  if (rules.longBlendWhenCompatible && isCompatible(rel) && absDelta <= 3) {
    const style = pick('Blend');
    const bars: TransitionBars = defaultBars === 16 || (rel === 'same' && absDelta <= 1.5) ? 16 : 8;
    return make(
      style,
      bars,
      `${capital(keyText)}, ${tempoText}. A long ${style} works: ${bars} bars.`,
      'Swap the lows halfway through.',
    );
  }

  if (rel === 'energy-boost' && absDelta <= step && allowed('Rise')) {
    return make('Rise', 8, `${capital(keyText)}, ${tempoText}. Rise makes the lift feel planned.`, 'Swap the lows at the end.');
  }

  if (energyDelta != null && energyDelta <= -0.15 && absDelta <= step) {
    const style = pick('Fade');
    return make(
      style,
      defaultBars,
      `Energy drops (${e2(a.energy!)} → ${e2(b.energy!)}), ${keyText}. A gentle ${style} lets the outgoing track ring out.`,
      'Bring the lows of the outgoing track down first.',
    );
  }

  if (absDelta <= step && rel !== 'clash') {
    const style = pick('Fade');
    return make(style, defaultBars, `${capital(keyText)}, ${tempoText}. A standard ${style} of ${defaultBars} bars.`, 'Swap the lows near the middle.');
  }

  return make('Auto', null, `${capital(keyText)}, ${tempoText}. No rule fits well, so leave Auto.`);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
