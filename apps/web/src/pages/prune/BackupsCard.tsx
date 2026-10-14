import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RECOVER_PLAYLISTS_URL, type BackupInfo, type RestoreResult } from '@curator/shared';
import { api } from '../../api.ts';
import { Button, Card, Empty, ErrorNote } from '../../components/ui.tsx';
import { KindBadge } from './CandidateTable.tsx';
import { day } from './format.ts';

export function BackupsCard() {
  const qc = useQueryClient();
  const backups = useQuery({ queryKey: ['prune', 'backups'], queryFn: () => api<BackupInfo[]>('/api/prune/backups') });
  const [last, setLast] = useState<RestoreResult | null>(null);
  const restore = useMutation({
    mutationFn: (id: number) => api<RestoreResult>(`/api/prune/restore/${id}`, { method: 'POST' }),
    onSuccess: (r) => {
      setLast(r);
      void qc.invalidateQueries({ queryKey: ['prune'] });
    },
  });

  return (
    <Card title="3 · Backups">
      <p className="mb-3 text-sm text-zinc-400">
        Every pruned playlist has a Backup here. <b className="text-zinc-200">Restore</b> follows a Followed Playlist again,
        or recreates an Owned Playlist as a <i>new</i> playlist with the same name and tracks (new link, no followers). To
        get the original Owned Playlist back within 90 days, use Spotify’s{' '}
        <a className="text-brand underline" href={RECOVER_PLAYLISTS_URL} target="_blank" rel="noreferrer">
          Recover playlists
        </a>{' '}
        page instead.
      </p>
      <ErrorNote error={backups.error ?? restore.error} />
      {last && (
        <p className="mb-3 rounded bg-emerald-950/50 p-2 text-sm text-emerald-300">
          {last.action === 'refollowed' ? 'Followed again.' : `Recreated with ${last.added} tracks${last.skipped ? ` (${last.skipped} local files skipped)` : ''}.`}{' '}
          <a className="underline" href={last.url} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        </p>
      )}
      {backups.data?.length === 0 ? (
        <Empty>No Backups yet. They appear here after you prune.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="p-2">Playlist</th>
                <th className="p-2 text-right">Tracks</th>
                <th className="p-2">Backed up</th>
                <th className="p-2">File</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {backups.data?.map((b) => (
                <tr key={b.id} className="border-t border-zinc-800">
                  <td className="p-2">
                    <div className="font-medium">{b.name}</div>
                    <KindBadge kind={b.kind} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{b.trackCount}</td>
                  <td className="p-2 tabular-nums">{day(b.createdAt)}</td>
                  <td className="max-w-xs truncate p-2 text-xs text-zinc-500" title={b.file ?? ''}>
                    {b.file}
                  </td>
                  <td className="p-2 text-right">
                    {b.restored ? (
                      <span className="text-xs text-zinc-400">
                        Restored {day(b.restored.at)}
                        {b.restored.url && (
                          <>
                            {' · '}
                            <a className="underline" href={b.restored.url} target="_blank" rel="noreferrer">
                              open
                            </a>
                          </>
                        )}
                      </span>
                    ) : (
                      <Button
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(b.id)}
                        title={b.kind === 'owned' ? 'Create a new playlist from this Backup' : 'Follow this playlist again'}
                      >
                        {restore.isPending && restore.variables === b.id ? 'Restoring…' : 'Restore'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
