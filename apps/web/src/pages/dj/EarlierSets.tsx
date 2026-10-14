import { useState } from 'react';
import type { DjSetSummary } from '@curator/shared';
import { Badge, Button, Card, cx, ErrorNote } from '../../components/ui.tsx';
import { countSets, filterSets, isDraft, isoDay, SET_FILTERS, type SetFilter } from './saved.ts';
import { fmtDuration } from './sheet.ts';

type Props = {
  sets: DjSetSummary[] | undefined;
  error: unknown;
  viewingId: string | null;
  /** The set shown in the builder right now (a linked draft or a copy). */
  openId: string | null;
  /** Opens a set in the builder, exactly as saved, to keep working on it. */
  onOpen: (id: string) => void;
  /** Opens the apply view of a set on Spotify (ticks for transitions set in Spotify). */
  onView: (id: string) => void;
  onDelete: (id: string) => Promise<unknown>;
};

/** Saved DJ Sets: drafts and sets created on Spotify. */
export function EarlierSets({ sets, error, viewingId, openId, onOpen, onView, onDelete }: Props) {
  const [filter, setFilter] = useState<SetFilter>('all');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const all = sets ?? [];
  const counts = countSets(all);
  const shown = filterSets(all, filter);

  const remove = async (id: string) => {
    setDeleting(id);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirming(null);
    } catch (e) {
      setDeleteError(e);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card
      title="Earlier sets"
      actions={
        all.length > 0 && (
          <div role="group" aria-label="Show" className="flex rounded-full bg-zinc-800 p-0.5 text-xs">
            {SET_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={cx('rounded-full px-2.5 py-1', filter === f.value ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:text-zinc-100')}
              >
                {f.label} <span className="tabular-nums opacity-60">{counts[f.value]}</span>
              </button>
            ))}
          </div>
        )
      }
    >
      <ErrorNote error={error} />
      <ErrorNote error={deleteError} />
      {shown.length > 0 ? (
        <ul className="divide-y divide-zinc-800 text-sm">
          {shown.map((s) => {
            const draft = isDraft(s);
            const pairs = Math.max(0, s.tracks - 1);
            const applied = s.applied ?? 0;
            return (
              <li key={s.id} className="py-1">
                <div
                  role="button"
                  tabIndex={0}
                  title={draft ? 'Open this draft and keep working on it' : 'Open a copy of this set to change it'}
                  onClick={() => onOpen(s.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onOpen(s.id);
                    }
                  }}
                  className={cx(
                    '-mx-2 flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/60',
                    openId === s.id && 'bg-zinc-800/80 ring-1 ring-zinc-600',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {draft ? <Badge tone="warn">Draft</Badge> : <Badge tone="good">On Spotify</Badge>}
                      {openId === s.id && <Badge tone="info">Open in builder</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {draft ? `Updated ${isoDay(s.updatedAt ?? s.createdAt)}` : isoDay(s.createdAt)} · {s.tracks} tracks · {fmtDuration(s.durationMs)} · score{' '}
                      {s.score}
                      {!draft && (
                        <>
                          {' · '}
                          <span className={applied >= pairs && pairs > 0 ? 'text-brand' : undefined}>
                            {applied}/{pairs} applied
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {s.spotifyUrl && (
                      <a href={s.spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1 text-sm text-brand hover:bg-zinc-700">
                        Open in Spotify
                      </a>
                    )}
                    {!draft && (
                      <Button
                        variant={viewingId === s.id ? 'secondary' : 'ghost'}
                        onClick={() => onView(s.id)}
                        title="Step through the transitions and tick each one once it is set in Spotify"
                      >
                        Apply in Spotify {applied}/{pairs}
                      </Button>
                    )}
                    <button
                      onClick={() => setConfirming(confirming === s.id ? null : s.id)}
                      className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                      aria-label={`Delete “${s.name}”`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {confirming === s.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-200">
                    <span className="flex-1">
                      {draft
                        ? 'Delete this draft? Its tracks and Transition Sheet are gone after this.'
                        : 'Remove this set from the app? The playlist stays on Spotify; only its Transition Sheet and ticks here are deleted.'}
                    </span>
                    <Button variant="danger" className="px-3 py-1 text-xs" disabled={deleting === s.id} onClick={() => void remove(s.id)}>
                      {deleting === s.id ? 'Deleting…' : draft ? 'Delete draft' : 'Delete'}
                    </Button>
                    <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          {filter === 'drafts'
            ? 'No drafts. Press Save draft under a set to keep it without creating it on Spotify.'
            : filter === 'created'
              ? 'No sets on Spotify yet.'
              : 'Sets you save as a draft or create on Spotify appear here with their Transition Sheet.'}
        </p>
      )}
    </Card>
  );
}
