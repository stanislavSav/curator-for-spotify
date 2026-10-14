import type { ButtonHTMLAttributes } from 'react';
import type { DjSetResult, TransitionBars, TransitionSettings } from '@curator/shared';
import { Badge } from '../../components/ui.tsx';
import { LEGEND } from './sheet.ts';
import { TransitionCard } from './TransitionCard.tsx';

interface SheetProps {
  result: DjSetResult;
  maxBpmStepPct: number;
  defaultBars: TransitionBars;
  /** Omit for a read-only sheet. */
  onEdit?: (index: number, s: TransitionSettings) => void;
  /** Only for created sets: the Applied checklist. */
  onApplied?: (index: number, v: boolean) => void;
}

/** The Transition Sheet: one Spotify-style card per pair. */
export function TransitionSheet({ result, maxBpmStepPct, defaultBars, onEdit, onApplied }: SheetProps) {
  if (result.transitions.length === 0) return <p className="text-sm text-zinc-500">A set needs two tracks or more for transitions.</p>;
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-zinc-400">{LEGEND}</p>
      <div className="grid gap-3 xl:grid-cols-2">
        {result.transitions.map((tr, i) => (
          <TransitionCard
            key={`${result.tracks[i]!.id}>${result.tracks[i + 1]!.id}`}
            index={i}
            transition={tr}
            from={result.tracks[i]!}
            to={result.tracks[i + 1]!}
            maxBpmStepPct={maxBpmStepPct}
            defaultBars={defaultBars}
            onChange={onEdit && ((s) => onEdit(i, s))}
            onApplied={onApplied && ((v) => onApplied(i, v))}
          />
        ))}
      </div>
    </div>
  );
}

export function AppliedProgress({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex items-center gap-2 text-sm font-normal text-zinc-400">
      <span className="h-1.5 w-20 overflow-hidden rounded bg-zinc-800">
        <span className="block h-full bg-brand transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
      <span className="tabular-nums">
        {done}/{total} applied
      </span>
    </span>
  );
}

interface TrackListProps {
  result: DjSetResult;
  /** Row actions; omit for a read-only list (created sets). */
  actions?: {
    lockedIds: string[];
    startId: string | null;
    onLock: (id: string) => void;
    onStart: (id: string) => void;
    onRemove: (id: string) => void;
  };
}

/** The tracks in set order, with Lock, Start and Remove for a preview. */
export function TrackList({ result, actions }: TrackListProps) {
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
            {actions && <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {result.tracks.map((t, i) => {
            const locked = actions?.lockedIds.includes(t.id) ?? t.locked;
            const isStart = actions?.startId === t.id;
            return (
              <tr key={t.id} className="border-t border-zinc-800 align-top">
                <td className="py-1.5 pr-2 tabular-nums text-zinc-500">{i + 1}</td>
                <td className="max-w-72 py-1.5 pr-2">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-medium" title={t.name}>
                      {t.name}
                    </span>
                    {locked && <Badge tone="info">locked</Badge>}
                    {isStart && <Badge tone="info">start</Badge>}
                  </div>
                  <div className="truncate text-xs text-zinc-400">{t.artists.join(', ')}</div>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t.bpm}</td>
                <td className="py-1.5 pr-2 tabular-nums">{t.camelot ?? <span className="text-zinc-600">—</span>}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {t.energy?.toFixed(2) ?? <span className="text-zinc-600">—</span>}
                  <div className="text-xs text-zinc-500">→ {t.targetEnergy.toFixed(2)}</div>
                </td>
                {actions && (
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <RowButton onClick={() => actions.onLock(t.id)} title="A locked track stays in the set when you change settings or regenerate">
                      {locked ? 'Unlock' : 'Lock'}
                    </RowButton>
                    <RowButton onClick={() => actions.onStart(t.id)} title="Start the set with this track">
                      {isStart ? 'Unstart' : 'Start'}
                    </RowButton>
                    <RowButton onClick={() => actions.onRemove(t.id)} title="Remove this track; the set rebuilds">
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

function RowButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40" />;
}
