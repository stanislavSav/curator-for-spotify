import type { ButtonHTMLAttributes } from 'react';
import { BARS_NOTE, TRANSITION_STYLES, type DjSetResult, type DjTransition, type KeyRelation } from '@curator/shared';
import { Badge, cx } from '../../components/ui.tsx';
import { fmtPct } from './sheet.ts';

const RELATION: Record<KeyRelation, { label: string; tone: 'good' | 'info' | 'bad' | 'neutral'; about: string }> = {
  same: { label: 'same key', tone: 'good', about: 'Same Camelot key: a perfect match.' },
  adjacent: { label: 'adjacent', tone: 'good', about: 'One step on the Camelot wheel: smooth.' },
  relative: { label: 'relative', tone: 'good', about: 'Relative major/minor: smooth, changes the mood.' },
  'energy-boost': { label: 'boost', tone: 'info', about: 'An energy-boost key move (+2, +7 or diagonal). Use it sparingly.' },
  clash: { label: 'clash', tone: 'bad', about: 'The keys clash. Keep the transition short.' },
  unknown: { label: 'key ?', tone: 'neutral', about: 'At least one key is unknown.' },
};

interface Props {
  result: DjSetResult;
  maxBpmStepPct: number;
  /** Row actions; omit for a read-only sheet (history). */
  actions?: {
    lockedIds: string[];
    startId: string | null;
    onLock: (id: string) => void;
    onStart: (id: string) => void;
    onRemove: (id: string) => void;
    busy: boolean;
  };
}

export function TransitionSheet({ result, maxBpmStepPct, actions }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Track</th>
            <th className="py-2 pr-2 text-right">BPM</th>
            <th className="py-2 pr-2">Key</th>
            <th className="py-2 pr-2 text-right" title="Actual energy, with the target from the Energy Curve below">
              Energy
            </th>
            <th className="py-2 pr-2">Transition to next</th>
            {actions && <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {result.tracks.map((t, i) => {
            const tr = result.transitions[i];
            const locked = actions?.lockedIds.includes(t.id) ?? t.locked;
            const isStart = actions?.startId === t.id;
            return (
              <tr key={t.id} className="border-t border-zinc-800 align-top">
                <td className="py-2 pr-2 tabular-nums text-zinc-500">{i + 1}</td>
                <td className="max-w-56 py-2 pr-2">
                  <div className="truncate font-medium" title={t.name}>
                    {t.name}
                  </div>
                  <div className="truncate text-xs text-zinc-400">{t.artists.join(', ')}</div>
                  <div className="mt-0.5 flex gap-1">
                    {locked && <Badge tone="info">locked</Badge>}
                    {isStart && <Badge tone="info">start</Badge>}
                  </div>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{t.bpm}</td>
                <td className="py-2 pr-2 tabular-nums">{t.camelot ?? <span className="text-zinc-600">—</span>}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {t.energy?.toFixed(2) ?? <span className="text-zinc-600">—</span>}
                  <div className="text-xs text-zinc-500">→ {t.targetEnergy.toFixed(2)}</div>
                </td>
                <td className="min-w-64 py-2 pr-2">{tr ? <TransitionCell tr={tr} maxBpmStepPct={maxBpmStepPct} /> : <span className="text-xs text-zinc-600">End of set</span>}</td>
                {actions && (
                  <td className="whitespace-nowrap py-2 text-right">
                    <RowButton disabled={actions.busy} onClick={() => actions.onLock(t.id)} title="A locked track stays in the set when you regenerate">
                      {locked ? 'Unlock' : 'Lock'}
                    </RowButton>
                    <RowButton disabled={actions.busy} onClick={() => actions.onStart(t.id)} title="Start the set with this track">
                      {isStart ? 'Unstart' : 'Start'}
                    </RowButton>
                    <RowButton disabled={actions.busy} onClick={() => actions.onRemove(t.id)} title="Remove this track and build again">
                      Remove
                    </RowButton>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransitionCell({ tr, maxBpmStepPct }: { tr: DjTransition; maxBpmStepPct: number }) {
  const style = TRANSITION_STYLES[tr.style];
  const rel = RELATION[tr.keyRelation];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          title={style.about}
          className={cx(
            'rounded px-1.5 py-0.5 text-xs font-semibold',
            tr.style === 'Auto' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-900',
          )}
        >
          {tr.style}
          {style.status === 'likely' && '*'}
        </span>
        {tr.bars && (
          <span className="text-xs tabular-nums text-zinc-300" title={BARS_NOTE}>
            {tr.bars} bars
          </span>
        )}
        <Badge tone={rel.tone} title={rel.about}>
          {rel.label}
        </Badge>
        <span className={cx('text-xs tabular-nums', Math.abs(tr.bpmDeltaPct) > maxBpmStepPct ? 'text-amber-300' : 'text-zinc-400')} title="Tempo change to the next track">
          {fmtPct(tr.bpmDeltaPct)}
        </span>
        {tr.cutHint && (
          <Badge tone="bad" title="The jump is big. A quick cut may sound better than any blend.">
            cut?
          </Badge>
        )}
      </div>
      <p className="text-xs text-zinc-300">{tr.reason}</p>
      {tr.eqHint && <p className="text-xs text-zinc-500">EQ: {tr.eqHint}</p>}
    </div>
  );
}

function RowButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40" />;
}
