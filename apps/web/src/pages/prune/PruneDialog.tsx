import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  RECOVER_PLAYLISTS_URL,
  type PruneCandidate,
  type PruneJobResponse,
  type PruneResult,
  type PruneResultsResponse,
} from '@curator/shared';
import { api, useJob } from '../../api.ts';
import { Badge, Button, ErrorNote, JobProgress } from '../../components/ui.tsx';
import { KindBadge } from './CandidateTable.tsx';
import { plural } from './format.ts';

/** Confirm → job progress → per-playlist results. */
export function PruneDialog({
  playlists,
  onClose,
}: {
  playlists: PruneCandidate[];
  /** Called with true when a prune ran, so the page can refresh. */
  onClose: (ran: boolean) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const running = job.data?.status === 'running' || (jobId !== null && !job.data);
  const results = useQuery({
    queryKey: ['prune', 'results', jobId],
    queryFn: () => api<PruneResultsResponse>(`/api/prune/results/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: running ? 700 : false,
  });
  const start = useMutation({
    mutationFn: () =>
      api<PruneJobResponse>('/api/prune', { method: 'POST', json: { playlistIds: playlists.map((p) => p.id) } }),
    onSuccess: (r) => setJobId(r.job.id),
  });

  const owned = playlists.filter((p) => p.kind === 'owned');
  const followed = playlists.filter((p) => p.kind === 'followed');
  const finished = job.data && job.data.status !== 'running';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="border-b border-zinc-800 p-4">
          <h2 className="text-lg font-semibold">
            {jobId ? (finished ? 'Prune finished' : 'Pruning…') : `Prune ${plural(playlists.length, 'playlist')}?`}
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {!jobId ? (
            <>
              <ul className="space-y-1 text-zinc-300">
                <li>
                  <b className="text-zinc-100">Owned Playlists are deleted.</b> Spotify keeps them for 90 days: you can get
                  the original back at{' '}
                  <a className="text-brand underline" href={RECOVER_PLAYLISTS_URL} target="_blank" rel="noreferrer">
                    Recover playlists
                  </a>
                  .
                </li>
                <li>
                  <b className="text-zinc-100">Followed Playlists are unfollowed.</b> The owner keeps them; you can follow
                  them again.
                </li>
                <li>
                  Before each one, a <b className="text-zinc-100">Backup</b> (name, description, tracks in order) is saved
                  to <code className="text-zinc-400">data/backups/</code>. You can restore it below.
                </li>
              </ul>
              <NameList title={`Delete (${owned.length})`} rows={owned} />
              <NameList title={`Unfollow (${followed.length})`} rows={followed} />
              <ErrorNote error={start.error} />
            </>
          ) : (
            <>
              <JobProgress job={job.data} />
              <ResultList results={results.data?.results ?? []} />
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-800 p-4">
          {!jobId ? (
            <>
              <Button variant="ghost" onClick={() => onClose(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={start.isPending} onClick={() => start.mutate()}>
                Back up and prune {plural(playlists.length, 'playlist')}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={!finished} onClick={() => onClose(true)}>
              Close
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function NameList({ title, rows }: { title: string; rows: PruneCandidate[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-zinc-950/60 p-2">
        {rows.map((p) => (
          <li key={p.id} className="flex justify-between gap-2">
            <span className="truncate">{p.name}</span>
            <span className="shrink-0 text-zinc-500 tabular-nums">{p.trackCount} tracks</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultList({ results }: { results: PruneResult[] }) {
  if (results.length === 0) return null;
  return (
    <ul className="divide-y divide-zinc-800 rounded-lg bg-zinc-950/60">
      {results.map((r) => (
        <li key={r.playlistId} className="flex items-start justify-between gap-3 p-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{r.name}</span>
              {r.kind && <KindBadge kind={r.kind} />}
            </div>
            {r.backupFile && (
              <div className="truncate text-xs text-zinc-500">
                Backup: {r.backupFile} ({r.trackCount} tracks from {r.tracksFrom})
              </div>
            )}
            {r.error && <div className="text-xs text-red-300">{r.error}</div>}
          </div>
          <span className="shrink-0">
            {r.status === 'pending' && <Badge>waiting</Badge>}
            {r.status === 'done' && <Badge tone="good">{r.action}</Badge>}
            {r.status === 'failed' && <Badge tone="bad">failed</Badge>}
          </span>
        </li>
      ))}
    </ul>
  );
}
