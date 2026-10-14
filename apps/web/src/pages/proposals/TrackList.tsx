import type { ProposalTrackView } from '@curator/shared';
import { cx } from '../../components/ui.tsx';
import { trackTime } from './data.ts';

const iconBtn =
  'rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-20';

/** The ordered track list of one Proposal. Changes are sent as a full new id list. */
export function TrackList({
  tracks,
  readOnly,
  busy,
  onChange,
}: {
  tracks: ProposalTrackView[];
  readOnly: boolean;
  busy: boolean;
  onChange: (ids: string[]) => void;
}) {
  const ids = tracks.map((t) => t.id);
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => onChange(ids.filter((_, j) => j !== i));

  return (
    <ol className="max-h-[28rem] divide-y divide-zinc-800/70 overflow-y-auto rounded-lg border border-zinc-800 text-sm">
      {tracks.map((t, i) => (
        <li key={t.id} className={cx('flex items-start gap-3 px-3 py-2', !t.known && 'bg-red-950/30')}>
          <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-zinc-500">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate">
              {t.known ? (
                <>
                  <span className="text-zinc-100">{t.name}</span>
                  <span className="text-zinc-400"> — {t.artists.join(', ')}</span>
                </>
              ) : (
                <span className="text-red-300" title="This id is not in the local Library. It is skipped when the playlist is created.">
                  Unknown track <code className="text-xs">{t.id}</code>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
              {t.year && <span>{t.year}</span>}
              {t.bpm && <span>{t.bpm} BPM</span>}
              {t.camelot && <span>{t.camelot}</span>}
              {t.energy != null && <span>energy {t.energy.toFixed(2)}</span>}
              {t.known && <span>{trackTime(t.durationMs)}</span>}
              {t.tags.length > 0 && <span className="truncate">{t.tags.slice(0, 3).join(', ')}</span>}
            </div>
            {t.reason && <div className="mt-0.5 text-xs italic text-zinc-400">{t.reason}</div>}
          </div>
          {!readOnly && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button className={iconBtn} disabled={busy || i === 0} onClick={() => move(i, -1)} title="Move up">
                ↑
              </button>
              <button className={iconBtn} disabled={busy || i === tracks.length - 1} onClick={() => move(i, 1)} title="Move down">
                ↓
              </button>
              <button
                className={cx(iconBtn, 'hover:text-red-300')}
                disabled={busy || tracks.length <= 1}
                onClick={() => remove(i)}
                title="Remove from this proposal"
              >
                ✕
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
