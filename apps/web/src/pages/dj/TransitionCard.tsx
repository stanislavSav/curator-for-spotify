import { useState } from 'react';
import {
  BAR_OPTIONS,
  MIX_PRESETS,
  SETTING_ROWS,
  toBars,
  type DjSetTrack,
  type DjTransition,
  type KeyRelation,
  type TransitionBars,
  type TransitionSettings,
} from '@curator/shared';
import { Badge, cx } from '../../components/ui.tsx';
import { BARS_HINT, barsNote, pairHints } from './ai.ts';
import { AiBadge, RulesVsAi } from './AiPass.tsx';
import { isEdited, pairTitle, presetHasBars, presetLine, rowValue, withPreset } from './edits.ts';
import { fmtEnergyDelta, fmtPct } from './sheet.ts';

export const RELATION: Record<KeyRelation, { label: string; tone: 'good' | 'info' | 'bad' | 'neutral'; about: string }> = {
  same: { label: 'same key', tone: 'good', about: 'Same Camelot key: a perfect match.' },
  adjacent: { label: 'adjacent key', tone: 'good', about: 'One step on the Camelot wheel: smooth.' },
  relative: { label: 'relative key', tone: 'good', about: 'Relative major/minor: smooth, changes the mood.' },
  'energy-boost': { label: 'key boost', tone: 'info', about: 'An energy-boost key move (+2, +7 or diagonal). Use it sparingly.' },
  clash: { label: 'key clash', tone: 'bad', about: 'The keys clash. Keep the transition short.' },
  unknown: { label: 'key ?', tone: 'neutral', about: 'At least one key is unknown.' },
};

const BARS_NOTE = 'Bars are a length to aim for: 2, 4 or 8, and 16 for some tracks. Spotify sets the exact length, and shows no bar choice when it finds no clear beat.';

export interface PairProps {
  index: number;
  transition: DjTransition;
  from: DjSetTrack;
  to: DjSetTrack;
  maxBpmStepPct: number;
}

interface CardProps extends PairProps {
  defaultBars: TransitionBars;
  /** Omit for a read-only card. */
  onChange?: (s: TransitionSettings) => void;
  /** Only for created sets. */
  onApplied?: (v: boolean) => void;
}

/** One Spotify-style transition card: both tracks, the preset, bars and the five rows. */
export function TransitionCard({ defaultBars, onChange, onApplied, ...pair }: CardProps) {
  const [editing, setEditing] = useState(false);
  const { transition: tr, index } = pair;
  const edited = isEdited(tr);
  const done = onApplied != null && tr.applied;
  return (
    <article
      className={cx(
        'rounded-xl border p-4 transition',
        done ? 'border-zinc-800/60 bg-zinc-900/30 opacity-60 hover:opacity-100' : 'border-zinc-800 bg-zinc-900',
      )}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onApplied && (
            <input
              type="checkbox"
              checked={tr.applied}
              onChange={(e) => onApplied(e.target.checked)}
              aria-label={`Transition ${index + 1} → ${index + 2} applied in Spotify`}
              title="Tick when you have set this transition in Spotify"
              className="size-4 accent-brand"
            />
          )}
          <h3 className="font-semibold tabular-nums">{pairTitle(index, tr.settings)}</h3>
          {edited && (
            <Badge tone="info" title="You changed the suggestion">
              edited
            </Badge>
          )}
          <AiBadge transition={tr} />
          {done && <Badge tone="good">✓ applied</Badge>}
        </div>
        {onChange && (
          <div className="flex gap-1">
            {editing && edited && (
              <button
                className="rounded-full px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => onChange(tr.suggested)}
              >
                Reset to rules
              </button>
            )}
            <button
              className={cx(
                'rounded-full px-3 py-1 text-xs font-medium',
                editing ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
              )}
              onClick={() => setEditing(!editing)}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
        )}
      </header>
      <div className="mb-3 empty:hidden">
        <RulesVsAi transition={tr} onChange={onChange} />
      </div>
      <TransitionBody {...pair} onChange={editing ? onChange : undefined} defaultBars={defaultBars} />
    </article>
  );
}

/** The body of a card, also used large in Apply mode. With onChange the rows become selects. */
export function TransitionBody({
  index,
  transition: tr,
  from,
  to,
  maxBpmStepPct,
  large = false,
  onChange,
  defaultBars = 8,
}: PairProps & { large?: boolean; onChange?: (s: TransitionSettings) => void; defaultBars?: TransitionBars }) {
  const s = tr.settings;
  const p = presetLine(s.preset);
  const rel = RELATION[tr.keyRelation];
  const named = s.preset !== 'Custom' && presetHasBars(s.preset);
  const note = barsNote(tr);
  const hints = pairHints(from, to);
  return (
    <div className={cx('space-y-3', large && 'space-y-5')}>
      <div className="space-y-1">
        <TrackLine track={from} role="out" n={index + 1} large={large} />
        <div className="flex flex-wrap items-center justify-center gap-x-2">
          {onChange ? (
            <select
              aria-label="Bars"
              value={toBars(s.bars) ?? ''}
              disabled={!presetHasBars(s.preset)}
              onChange={(e) => onChange({ ...s, bars: Number(e.target.value) as TransitionBars })}
              className="rounded-full bg-zinc-800 px-3 py-1 text-sm disabled:opacity-50"
              title={BARS_NOTE}
            >
              {s.bars == null && <option value="">Spotify decides</option>}
              {BAR_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} bars
                </option>
              ))}
            </select>
          ) : (
            <span
              className={cx('rounded-full bg-zinc-800 px-3 py-0.5 tabular-nums text-zinc-200', large ? 'text-base' : 'text-xs')}
              title={BARS_NOTE}
            >
              {s.bars ? `${s.bars} bars` : s.preset === 'No transition' ? 'no overlap' : 'Spotify decides'}
            </span>
          )}
          {s.bars != null && !note && <span className={cx('text-zinc-500', large ? 'text-sm' : 'text-xs')}>{BARS_HINT}</span>}
        </div>
        {note && (
          <p className={cx('text-center text-amber-300', large ? 'text-base' : 'text-xs')} role="note">
            {note}
          </p>
        )}
        <TrackLine track={to} role="in" n={index + 2} large={large} />
      </div>

      {onChange ? (
        <div>
          <div className="mb-1 text-xs text-zinc-500">Mix Preset</div>
          <div className="flex flex-wrap gap-1">
            {MIX_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => onChange(withPreset(s, m, tr.suggested, defaultBars))}
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs',
                  m === s.preset ? 'bg-zinc-100 font-medium text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {named && <p className="mt-1 text-xs text-zinc-500">Values set by Spotify. Pick Custom to set each row.</p>}
        </div>
      ) : (
        <p className={cx('text-zinc-300', large ? 'text-xl' : 'text-sm')}>
          {p.before}
          <mark className="rounded bg-brand/20 px-1 font-semibold text-brand">{p.name}</mark>
          {p.after}
        </p>
      )}

      {/* A preset that sets every row needs no five "preset decides" rows. */}
      {!onChange && s.preset !== 'Custom' && SETTING_ROWS.every((row) => s[row.key] == null) ? (
        <p className={cx('rounded-lg bg-zinc-800/60 text-zinc-400', large ? 'px-4 py-3 text-lg' : 'px-3 py-1.5 text-xs')}>
          Volume, EQ, Filter, Effects and Looping: set by the preset.
        </p>
      ) : (
      <div className={cx('space-y-1', large && 'space-y-2')}>
        {SETTING_ROWS.map((row) => {
          const value = s[row.key];
          return (
            <div
              key={row.key}
              className={cx('flex items-center justify-between gap-3 rounded-lg bg-zinc-800/60', large ? 'px-4 py-3 text-xl' : 'px-3 py-1.5 text-sm')}
            >
              <span className="flex items-center gap-2 text-zinc-200">
                <span className={cx('w-1 rounded-full', large ? 'h-6' : 'h-4')} style={{ background: row.color }} aria-hidden />
                {row.label}
              </span>
              {onChange && s.preset === 'Custom' ? (
                <select
                  aria-label={row.label}
                  value={value ?? ''}
                  onChange={(e) => onChange({ ...s, [row.key]: e.target.value })}
                  className="min-w-0 max-w-[65%] rounded bg-zinc-900 px-2 py-0.5 text-right text-sm"
                >
                  {row.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cx('text-right', value ? 'font-medium text-zinc-100' : 'text-zinc-500')}>{rowValue(s, row.key)}</span>
              )}
            </div>
          );
        })}
      </div>
      )}

      <div className={cx('flex flex-wrap items-center gap-1.5', large && 'text-base')}>
        <Badge tone={Math.abs(tr.bpmDeltaPct) > maxBpmStepPct ? 'warn' : 'neutral'} title="Tempo change to the incoming track">
          tempo {fmtPct(tr.bpmDeltaPct)}
        </Badge>
        <Badge tone={rel.tone} title={rel.about}>
          {rel.label}
        </Badge>
        {tr.energyDelta != null && (
          <Badge tone="neutral" title="Energy of the incoming track minus the outgoing one">
            energy {fmtEnergyDelta(tr.energyDelta)}
          </Badge>
        )}
        {hints.map((h) => (
          <Badge key={h.label} tone="neutral" title={h.about}>
            {h.label}
          </Badge>
        ))}
      </div>
      <p className={cx('text-zinc-400', large ? 'text-base' : 'text-xs')}>{tr.reason}</p>
      {tr.ai && tr.ai.reason && (
        <p className={cx('text-zinc-300', large ? 'text-base' : 'text-xs')}>
          <span className="font-semibold">✦ AI:</span> {tr.ai.reason}
        </p>
      )}
    </div>
  );
}

function TrackLine({ track, role, n, large }: { track: DjSetTrack; role: 'in' | 'out'; n: number; large: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-3', large ? 'text-xl' : 'text-sm')}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="w-7 shrink-0 text-xs uppercase text-zinc-500" title={role === 'out' ? 'Outgoing track' : 'Incoming track'}>
          {role}
        </span>
        <span className="shrink-0 tabular-nums text-zinc-500">{n}.</span>
        <span className="min-w-0 truncate" title={`${track.name} · ${track.artists.join(', ')}`}>
          <span className="font-medium text-zinc-100">{track.name}</span>
          <span className="text-zinc-400"> · {track.artists.join(', ')}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums text-zinc-300">
        {Math.round(track.bpm)} BPM
        <span
          className={cx(
            'rounded px-1.5 font-semibold',
            large ? 'text-base' : 'text-xs',
            track.camelot ? 'bg-amber-200 text-zinc-900' : 'bg-zinc-800 text-zinc-500',
          )}
          title="Camelot key"
        >
          {track.camelot ?? '—'}
        </span>
      </span>
    </div>
  );
}
