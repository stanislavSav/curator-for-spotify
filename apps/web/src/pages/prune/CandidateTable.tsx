import { useState, type ReactNode } from 'react';
import type { PruneCandidate, UsageEvidence } from '@curator/shared';
import { Badge, cx } from '../../components/ui.tsx';
import { ago, day, playlistUrl } from './format.ts';

export function KindBadge({ kind }: { kind: 'owned' | 'followed' }) {
  return kind === 'owned' ? (
    <Badge tone="warn" title="Owned Playlist: pruning deletes it.">
      Owned · delete
    </Badge>
  ) : (
    <Badge tone="info" title="Followed Playlist: pruning unfollows it.">
      Followed · unfollow
    </Badge>
  );
}

export function CandidateGroup({
  title,
  intro,
  rows,
  defaultOpen,
  isChecked,
  setChecked,
}: {
  title: ReactNode;
  intro: string;
  rows: PruneCandidate[];
  defaultOpen: boolean;
  isChecked: (row: PruneCandidate) => boolean;
  setChecked: (ids: string[], value: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ticked = rows.filter(isChecked).length;
  const all = rows.length > 0 && ticked === rows.length;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
      >
        <div>
          <h2 className="font-semibold">
            <span className="mr-2 inline-block w-3 text-zinc-500">{open ? '▾' : '▸'}</span>
            {title} <span className="text-zinc-500">({rows.length})</span>
          </h2>
          <p className="ml-5 text-sm text-zinc-400">{intro}</p>
        </div>
        {ticked > 0 && <Badge tone="bad">{ticked} ticked</Badge>}
      </button>
      {open &&
        (rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">None.</p>
        ) : (
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="w-8 p-2">
                    <input
                      type="checkbox"
                      aria-label="Tick all"
                      checked={all}
                      onChange={() => setChecked(rows.map((r) => r.id), !all)}
                      className="accent-red-500"
                    />
                  </th>
                  <th className="p-2">Playlist</th>
                  <th className="p-2 text-right">Tracks</th>
                  <th className="p-2">Last used</th>
                  <th className="p-2">Usage Evidence</th>
                  <th className="p-2">Why / notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <CandidateRow key={r.id} row={r} checked={isChecked(r)} onToggle={(v) => setChecked([r.id], v)} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

function CandidateRow({ row: r, checked, onToggle }: { row: PruneCandidate; checked: boolean; onToggle: (v: boolean) => void }) {
  return (
    <tr className={cx('border-t border-zinc-800 align-top', checked && 'bg-red-950/20')}>
      <td className="p-2">
        <input
          type="checkbox"
          aria-label={`Prune ${r.name}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-red-500"
        />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-3">
          {r.imageUrl ? (
            <img src={r.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded bg-zinc-800" />
          )}
          <div className="min-w-0">
            <a href={playlistUrl(r.id)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {r.name}
            </a>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
              <KindBadge kind={r.kind} />
              {r.kind === 'followed' && <span>by {r.ownerName}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="p-2 text-right tabular-nums">{r.trackCount}</td>
      <td className="whitespace-nowrap p-2">
        {r.lastUsed ? (
          <>
            <div className="tabular-nums">{day(r.lastUsed)}</div>
            <div className="text-xs text-zinc-500">{ago(r.lastUsed)}</div>
          </>
        ) : (
          <span className="text-zinc-500">never seen</span>
        )}
      </td>
      <td className="p-2">
        <EvidenceList evidence={r.evidence} source={r.lastUsedSource} />
      </td>
      <td className="max-w-sm p-2 text-xs">
        {r.reasons.map((t) => (
          <p key={t} className="text-zinc-300">
            {t}
          </p>
        ))}
        {r.notes.map((t) => (
          <p key={t} className="text-amber-300/80">
            {t}
          </p>
        ))}
      </td>
    </tr>
  );
}

function EvidenceList({ evidence: e, source }: { evidence: UsageEvidence; source: PruneCandidate['lastUsedSource'] }) {
  const line = (key: string, label: string, value: ReactNode) => (
    <div key={key} className={cx('whitespace-nowrap text-xs', source === key ? 'text-zinc-100' : 'text-zinc-500')}>
      <span className="inline-block w-20 text-zinc-500">{label}</span>
      {value}
    </div>
  );
  return (
    <div>
      {line(
        'context',
        'Played from',
        e.context ? `${day(e.context.lastPlayed)} · ${e.context.plays}×` : 'not in recent plays',
      )}
      {line(
        'exclusive',
        'Exclusive',
        e.exclusive
          ? e.exclusive.tracks === 0
            ? 'no Exclusive Tracks'
            : `${e.exclusive.tracks} tracks · ${e.exclusive.lastPlayed ? day(e.exclusive.lastPlayed) : 'never played'} · ${e.exclusive.playsInWindow} plays in window`
          : 'tracks unreadable',
      )}
      {line('edit', 'Edited', e.edit ? day(e.edit.lastAdded) : 'no dated edits')}
    </div>
  );
}
